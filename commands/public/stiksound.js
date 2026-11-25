import { sendSoundSticker } from "../../utils/soundSticker.js";
import { downloadContentFromMessage, prepareWAMessageMedia } from "baileys";
import ffmpegPath from "ffmpeg-static";
import { execFile } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";

const run = promisify(execFile);
const stickerDurationSeconds = "10";
const maxVideoMiB = 32;
const maxMediaBytes = maxVideoMiB * 1024 * 1024;
const maxStickerBytes = 990 * 1024;
const stickerProfiles = [
	{ fps: 12, quality: 45 },
	{ fps: 12, quality: 30 },
	{ fps: 8, quality: 25 },
	{ fps: 6, quality: 15 },
];
let activeJobs = 0;

async function* limitDownload(stream) {
	let size = 0;
	for await (const chunk of stream) {
		size += chunk.length;
		if (size > maxMediaBytes) {
			const error = new Error("Video exceeds the download limit");
			error.code = "SOS_VIDEO_TOO_LARGE";
			throw error;
		}
		yield chunk;
	}
}

const handler = async (sock, msg, from, _args, info) => {
	const video = msg.message?.videoMessage ?? info.extendedMessageOriginal?.quotedMessage?.videoMessage;
	const reply = (content) => info.sendMessageWTyping(from, content, { quoted: msg });
	const command = `${info.prefix}sos`;

	if (!video) {
		return reply({ text: `Reply to a video with ${command}, or send a video with ${command} as its caption.` });
	}
	if (!video.mediaKey || (!video.directPath && !video.url)) {
		return reply({ text: `WhatsApp did not provide download details for this video. Send it again with ${command} as its caption.` });
	}
	if (activeJobs >= 2) return reply({ text: "StikSound is busy. Try again in a moment." });

	activeJobs++;
	let directory;
	let stage = "download";
	try {
		directory = await mkdtemp(join(tmpdir(), "tars-stiksound-"));
		const input = join(directory, "input");
		const sticker = join(directory, "sticker.webp");
		const audio = join(directory, "audio.ogg");
		const stream = await downloadContentFromMessage(video, "video");
		await pipeline(stream, limitDownload, createWriteStream(input), { signal: AbortSignal.timeout(60000) });

		stage = "audio encode";
		const ffmpeg = process.env.FFMPEG_PATH || ffmpegPath || "ffmpeg";
		const inputOptions = [
			"-nostdin", "-v", "error", "-xerror", "-filter_threads", "1", "-y",
			"-protocol_whitelist", "file", "-format_whitelist", "mov,matroska,webm", "-i", input,
		];
		const options = { timeout: 30000, killSignal: "SIGKILL" };
		await run(ffmpeg, [
			...inputOptions,
			"-map", "0:a:0", "-af", "asetpts=N/SR/TB", "-t", stickerDurationSeconds, "-c:a", "libopus", "-ac", "1", "-b:a", "64k", audio,
		], options);

		stage = "animation encode";
		let webp;
		for (const { fps, quality } of stickerProfiles) {
			await run(ffmpeg, [
				...inputOptions,
				"-map", "0:v:0", "-t", stickerDurationSeconds,
				"-vf", `fps=${fps},scale=512:512:force_original_aspect_ratio=increase,crop=512:512,setsar=1`,
				"-c:v", "libwebp_anim", "-pix_fmt", "yuv420p", "-q:v", String(quality), "-loop", "0", sticker,
			], options);
			if ((await stat(sticker)).size <= maxStickerBytes) {
				webp = await readFile(sticker);
				break;
			}
		}
		if (!webp) {
			return reply({ text: "The animated sticker is still too large after compression. Try a shorter clip." });
		}
		stage = "upload or relay";
		const { audioMessage } = await prepareWAMessageMedia({
			audio: await readFile(audio),
			mimetype: "audio/ogg; codecs=opus",
		}, { upload: sock.waUploadToServer });
		const messageId = await sendSoundSticker(sock, from, webp, audioMessage, {
			width: 512,
			height: 512,
			isAnimated: webp.includes(Buffer.from("ANIM"), 12),
		});
		console.info(`[SOS] Sticker relay returned (message ID: ${messageId}).`);
	} catch (error) {
		console.warn(`[SOS] Failed during ${stage} (${error.code ?? error.name ?? "unknown error"}).`);
		if (error.stderr) {
			console.warn(`[SOS] FFmpeg: ${String(error.stderr).trim().slice(-1500)}`);
		}
		let text = "Could not create or send the sound sticker. Try a playable video.";
		if (error.code === "SOS_VIDEO_TOO_LARGE") {
			text = `The video exceeds ${maxVideoMiB} MiB. Send a smaller video.`;
		} else if (error.stderr?.includes("matches no streams")) {
			text = "This video is missing an audio or video track. Send a video with sound.";
		}
		await reply({ text });
	} finally {
		activeJobs--;
		if (directory) await rm(directory, { recursive: true, force: true }).catch(() => {});
	}
};

export default () => ({
	cmd: ["sos"],
	desc: "Create a sound sticker from up to 10 seconds of a video and its original audio.",
	usage: "sos | reply to a video or use as its caption",
	handler,
});
