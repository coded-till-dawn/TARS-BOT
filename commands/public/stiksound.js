import { randomBytes } from "node:crypto";
import { downloadContentFromMessage, prepareWAMessageMedia, proto } from "baileys";
import ffmpegPath from "ffmpeg-static";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const stickerDurationSeconds = "10";
const maxMediaBytes = 10 * 1024 * 1024;
let activeJobs = 0;

async function readLimited(stream, limit) {
	const chunks = [];
	let size = 0;
	for await (const chunk of stream) {
		size += chunk.length;
		if (size > limit) throw new Error("Media exceeds the download limit");
		chunks.push(chunk);
	}
	return Buffer.concat(chunks);
}

const encodeSticker = proto.Message.StickerMessage.encode;
let protoPatched = false;

function ensureAudioStickerProtoSupport() {
	const { StickerMessage, AudioMessage } = proto.Message;
	if ("audioMessage" in StickerMessage.prototype || protoPatched) return;

	StickerMessage.encode = encodeStickerWithAudio;
	protoPatched = true;

	function encodeStickerWithAudio(message, writer) {
		const output = encodeSticker(message, writer);
		if (message.audioMessage) {
			AudioMessage.encode(message.audioMessage, output.uint32(210).fork()).ldelim();
		}
		return output;
	}
}

async function sendSoundSticker(sock, jid, sticker, audio) {
	const [visual, sound] = await Promise.all([
		prepareWAMessageMedia({ sticker }, { upload: sock.waUploadToServer }),
		prepareWAMessageMedia({ audio, mimetype: "audio/ogg; codecs=opus" }, { upload: sock.waUploadToServer }),
	]);
	const stickerMessage = visual.stickerMessage;
	stickerMessage.isAnimated = sticker.includes(Buffer.from("ANIM"), 12);
	stickerMessage.width = 512;
	stickerMessage.height = 512;
	stickerMessage.audioMessage = sound.audioMessage;

	ensureAudioStickerProtoSupport();
	const messageId = "3EB0" + randomBytes(18).toString("hex").toUpperCase();
	await sock.relayMessage(jid, { stickerMessage }, { messageId });
	console.info(`[SOS] Sticker relay returned (message ID: ${messageId}).`);
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
		await writeFile(input, await readLimited(stream, maxMediaBytes));

		stage = "encode";
		await run(process.env.FFMPEG_PATH || ffmpegPath || "ffmpeg", [
			"-nostdin", "-v", "error", "-xerror", "-filter_threads", "1",
			"-protocol_whitelist", "file", "-format_whitelist", "mov,matroska,webm", "-i", input,
			"-map", "0:a:0", "-t", stickerDurationSeconds, "-c:a", "libopus", "-ac", "1", "-b:a", "64k", audio,
			"-map", "0:v:0", "-t", stickerDurationSeconds,
			"-vf", "fps=12,scale=512:512:force_original_aspect_ratio=increase,crop=512:512,setsar=1",
			"-c:v", "libwebp_anim", "-pix_fmt", "yuv420p", "-q:v", "45", "-loop", "0", sticker,
		], { timeout: 30000, killSignal: "SIGKILL" });

		const webp = await readFile(sticker);
		if (webp.length > 990 * 1024) {
			return reply({ text: "The animated sticker is too large. Try a shorter clip." });
		}
		stage = "upload or relay";
		await sendSoundSticker(sock, from, webp, await readFile(audio));
	} catch (error) {
		console.warn(`[SOS] Failed during ${stage} (${error.code ?? error.name ?? "unknown error"}).`);
		const text = error.stderr?.includes("matches no streams")
			? "This video has no audio track. Send a video with sound."
			: "Could not create or send the sound sticker. Send a playable video under 10 MB.";
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
