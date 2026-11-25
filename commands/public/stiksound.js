import { downloadContentFromMessage } from "baileys";
import ffmpegPath from "ffmpeg-static";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
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

const handler = async (_sock, msg, from, _args, info) => {
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
	try {
		directory = await mkdtemp(join(tmpdir(), "tars-stiksound-"));
		const input = join(directory, "input");
		const output = join(directory, "stiksound.mp4");
		const stream = await downloadContentFromMessage(video, "video");
		await writeFile(input, await readLimited(stream, maxMediaBytes));

		await run(process.env.FFMPEG_PATH || ffmpegPath || "ffmpeg", [
			"-nostdin", "-v", "error", "-xerror", "-filter_threads", "1",
			"-protocol_whitelist", "file", "-format_whitelist", "mov,matroska,webm", "-i", input,
			"-map", "0:v:0", "-map", "0:a:0",
			"-vf", "scale=512:512:force_original_aspect_ratio=increase,crop=512:512,setsar=1,fps=25",
			"-t", "5",
			"-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "veryfast",
			"-c:a", "aac", "-movflags", "+faststart", output,
		], { timeout: 30000, killSignal: "SIGKILL" });
		await reply({
			video: await readFile(output),
			mimetype: "video/mp4",
			caption: "Save this clip, then open WhatsApp’s sticker picker, tap Create, and select it from your gallery if your app supports sound stickers.",
		});
	} catch (error) {
		const text = error.stderr?.includes("matches no streams")
			? "This video has no audio track. Send a video with sound."
			: "Could not prepare the clip. Send a playable video under 10 MB.";
		await reply({ text });
	} finally {
		activeJobs--;
		if (directory) await rm(directory, { recursive: true, force: true }).catch(() => {});
	}
};

export default () => ({
	cmd: ["sos"],
	desc: "Prepare a video with its original audio for WhatsApp’s sticker creator.",
	usage: "sos | reply to a video or use as its caption",
	handler,
});
