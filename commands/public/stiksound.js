import { downloadContentFromMessage } from "baileys";
import ffmpegPath from "ffmpeg-static";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const maxMediaBytes = 10 * 1024 * 1024;
const myInstants = "https://www.myinstants.com";
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

async function fetchMyInstants(path, limit) {
	const response = await fetch(myInstants + path, {
		redirect: "error",
		signal: AbortSignal.timeout(10000),
	});
	if (!response.ok || !response.body) throw new Error("MyInstants download failed");
	return readLimited(response.body, limit);
}

const soundPathPattern = /^\/media\/sounds\/[a-z\d_.%~-]+\.(?:mp3|wav|ogg|m4a)$/i;

async function downloadSound(input) {
	const url = new URL(input);
	if (url.protocol !== "https:" || !["myinstants.com", "www.myinstants.com"].includes(url.hostname) ||
		url.port || url.username || url.password) {
		throw new Error("Expected an HTTPS MyInstants link");
	}
	let path = url.pathname;
	const instant = path.match(/^\/(?:(?:[a-z]{2}(?:-[a-z]{2})?)\/)?instant\/([a-z\d_-]+)\/?$/i);
	if (instant) {
		const page = await fetchMyInstants(`/en/instant/${instant[1]}/`, 1024 * 1024);
		path = page.toString().match(/\/media\/sounds\/[a-z\d_.%~-]+\.(?:mp3|wav|ogg|m4a)(?=["'])/i)?.[0];
	}
	if (!path || !soundPathPattern.test(path)) throw new Error("Could not find a MyInstants sound");
	return fetchMyInstants(path, maxMediaBytes);
}

async function downloadWhatsApp(media, type) {
	return readLimited(await downloadContentFromMessage(media, type), maxMediaBytes);
}

function visualFrom(message) {
	if (message?.stickerMessage) return [message.stickerMessage, "sticker"];
	if (message?.imageMessage) return [message.imageMessage, "image"];
	if (message?.videoMessage) return [message.videoMessage, "video"];
	if (message?.documentMessage?.mimetype === "image/gif") return [message.documentMessage, "document"];
	return [];
}

const handler = async (_sock, msg, from, args, info) => {
	const current = msg.message;
	const context = info.extendedMessageOriginal ?? current?.imageMessage?.contextInfo ?? current?.videoMessage?.contextInfo;
	const quoted = context?.quotedMessage;
	const [visual, type] = visualFrom(current?.imageMessage || current?.videoMessage ? current : quoted);
	const reply = (content) => info.sendMessageWTyping(from, content, { quoted: msg });
	const command = `${info.prefix}stiksound`;
	const audio = quoted?.audioMessage;

	if (!visual || args.length > 1 || (!args[0] && !audio)) {
		return reply({
			text: `Reply to a sticker, image, GIF, or video with ${command} <MyInstants link>. For a voice note or audio message, reply with an image or video captioned ${command}.`,
		});
	}
	if (visual.isAnimated && type === "sticker") {
		return reply({ text: "Send the animation as a GIF or video to use it with StikSound." });
	}
	if (activeJobs >= 2) return reply({ text: "StikSound is busy. Try again in a moment." });

	activeJobs++;
	let directory;
	try {
		directory = await mkdtemp(join(tmpdir(), "tars-stiksound-"));
		const visualFile = join(directory, "visual");
		const soundFile = join(directory, "sound");
		const output = join(directory, "stiksound.mp4");
		await writeFile(visualFile, await downloadWhatsApp(visual, type));
		await writeFile(soundFile, args[0] ? await downloadSound(args[0]) : await downloadWhatsApp(audio, "audio"));

		await run(process.env.FFMPEG_PATH || ffmpegPath || "ffmpeg", [
			"-nostdin", "-v", "error", "-xerror", "-filter_threads", "1",
			"-protocol_whitelist", "file", "-format_whitelist", "webp_pipe,png_pipe,jpeg_pipe,gif,mov,matroska,webm", "-i", visualFile,
			"-protocol_whitelist", "file", "-format_whitelist", "mp3,ogg,wav,mov,aac", "-i", soundFile,
			"-map", "0:v:0", "-map", "1:a:0",
			"-vf", "scale=512:512:force_original_aspect_ratio=increase,crop=512:512,setsar=1,fps=25,tpad=stop_mode=clone:stop_duration=5",
			"-t", "5", "-shortest",
			"-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "veryfast",
			"-c:a", "aac", "-movflags", "+faststart", output,
		], { timeout: 30000, killSignal: "SIGKILL" });
		await reply({ video: await readFile(output), mimetype: "video/mp4" });
	} catch {
		await reply({ text: "Could not make the video. Check that the media plays and each file is under 10 MB." });
	} finally {
		activeJobs--;
		if (directory) await rm(directory, { recursive: true, force: true }).catch(() => {});
	}
};

export default () => ({
	cmd: ["stiksound"],
	desc: "Make a short square video from a sticker or other media and a sound.",
	usage: "stiksound <MyInstants link> | reply to media",
	handler,
});
