import { findSoundSticker, getSoundSticker, sendSoundSticker } from "../../utils/soundSticker.js";
import { getMemberData } from "../../db/members.js";
import { downloadContentFromMessage, normalizeMessageContent, prepareWAMessageMedia } from "baileys";
import ffmpegPath from "ffmpeg-static";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import NodeCache from "node-cache";
import WSF from "wa-sticker-formatter";
import nodeWebpmux from "node-webpmux";
const { Image: WebpImage } = nodeWebpmux;

import fs from "fs";
import os from "os";
import path from "path";
const getRandom = (ext) => path.join(os.tmpdir(), `${Math.floor(Math.random() * 10000)}${ext}`);

const pendingStickers = new NodeCache({ stdTTL: 300, checkperiod: 60, useClones: false });

const run = promisify(execFile);
const audioFileExtension = /\.(?:mp3|m4a|aac|wav|ogg|opus|flac|webm)$/i;
const maxAudioBytes = 10 * 1024 * 1024;
let activeAudioJobs = 0;

async function readMedia(message, type, limit) {
	const stream = await downloadContentFromMessage(message, type);
	const chunks = [];
	let size = 0;
	for await (const chunk of stream) {
		size += chunk.length;
		if (size > limit) throw new RangeError("Media exceeds the size limit");
		chunks.push(chunk);
	}
	return Buffer.concat(chunks);
}

async function pairAudio(sock, msg, from, info) {
	const reply = (text) => info.sendMessageWTyping(from, { text }, { quoted: msg });
	const command = `${info.prefix}stealaudio`;
	const key = `${from}:${info.senderJid ?? msg.key.participant ?? from}`;
	const quoted = normalizeMessageContent(info.extendedMessageOriginal?.quotedMessage);
	const sticker = getSoundSticker(quoted);
	if (sticker) {
		if (!pendingStickers.has(key) && pendingStickers.getStats().keys >= 300) {
			pendingStickers.del(pendingStickers.keys()[0]);
		}
		pendingStickers.set(key, sticker);
		return reply(`Sticker selected for five minutes. Reply to an uploaded audio file or voice note with ${command}. I’ll use the first 10 seconds.`);
	}

	const document = quoted?.documentMessage;
	const audioDocument = document && (/^audio\//i.test(document.mimetype ?? "") || audioFileExtension.test(document.fileName ?? ""));
	const audioSource = quoted?.audioMessage ?? (audioDocument ? document : undefined);
	const selectedSticker = pendingStickers.get(key);
	if (!audioSource || !selectedSticker) {
		return reply(`Reply to a sticker with ${command}, then reply to an audio file or voice note with the same command.`);
	}
	if (activeAudioJobs >= 2) return reply("Sticker audio processing is busy. Try again in a moment.");

	pendingStickers.del(key);
	activeAudioJobs++;
	let directory;
	try {
		directory = await mkdtemp(path.join(os.tmpdir(), "tars-stealaudio-"));
		const input = path.join(directory, "input");
		const output = path.join(directory, "audio.ogg");
		const visual = await readMedia(selectedSticker, "sticker", 1024 * 1024);
		const mediaType = quoted.audioMessage ? "audio" : "document";
		await writeFile(input, await readMedia(audioSource, mediaType, maxAudioBytes));
		await run(process.env.FFMPEG_PATH || ffmpegPath || "ffmpeg", [
			"-nostdin", "-v", "error", "-xerror",
			"-protocol_whitelist", "file", "-format_whitelist", "mp3,mov,aac,wav,ogg,flac,matroska,webm", "-i", input,
			"-map", "0:a:0", "-af", "asetpts=N/SR/TB", "-t", "10",
			"-c:a", "libopus", "-ac", "1", "-b:a", "64k", output,
		], { timeout: 30000, killSignal: "SIGKILL" });
		const { audioMessage } = await prepareWAMessageMedia({
			audio: await readFile(output),
			mimetype: "audio/ogg; codecs=opus",
		}, { upload: sock.waUploadToServer });
		const { width, height, isAnimated } = selectedSticker;
		await sendSoundSticker(sock, from, visual, audioMessage, { width, height, isAnimated });
	} catch (error) {
		const reason = error instanceof RangeError ? "The sticker or audio file is too large." : "Could not process or send that audio.";
		return reply(`${reason} Select the sticker again with ${command} and try a playable file under 10 MiB.`);
	} finally {
		activeAudioJobs--;
		if (directory) await rm(directory, { recursive: true, force: true }).catch(() => {});
	}
}

async function addExifNodeWebpmux(buffer, pack, author) {
	const json = JSON.stringify({
		"sticker-pack-id": `${pack || ""}${author || ""}`.replace(/\s/g, ""),
		"sticker-pack-name": pack || "",
		"sticker-pack-publisher": author || "",
		"android-app-store-link": "",
		"ios-app-store-link": "",
	});
	const jsonBytes = Buffer.from(json, "utf-8");
	// TIFF header + 1 IFD entry (tag 0x4157, type UNDEFINED, offset 0x16)
	const header = Buffer.from([
		0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00,
		0x01, 0x00, 0x41, 0x57, 0x07, 0x00, 0x00, 0x00,
		0x00, 0x00, 0x16, 0x00, 0x00, 0x00,
	]);
	header.writeUIntLE(jsonBytes.length, 14, 4);
	const exif = Buffer.concat([header, jsonBytes]);

	const img = new WebpImage();
	await img.load(buffer);
	img.exif = exif;
	return await img.save(null); // returns Buffer, no disk I/O
}

const handler = async (sock, msg, from, args, msgInfoObj) => {
	const { evv, type, sendMessageWTyping, senderJid, command, extendedMessageOriginal } = msgInfoObj;
	if (command === "stealaudio") return pairAudio(sock, msg, from, msgInfoObj);
	const memberData = await getMemberData(senderJid);

	const quotedSticker = getSoundSticker(extendedMessageOriginal?.quotedMessage);
	const originalSticker = findSoundSticker(from, extendedMessageOriginal?.stanzaId, quotedSticker);
	const sticker = originalSticker ?? quotedSticker;
	const audio = sticker?.audioMessage;
	const hasAudio = Boolean(audio?.mediaKey?.length && (audio.directPath || audio.url));
	if (type === "extendedTextMessage" && sticker) {
		const sendSticker = async (buffer) => {
			console.info(`[STEAL] Sticker source: ${originalSticker ? "cache" : "quote"}; audio: ${hasAudio ? "available" : audio ? "incomplete" : "missing"}.`);
			if (hasAudio) {
				const { width, height, isAnimated } = sticker;
				const messageId = await sendSoundSticker(sock, from, buffer, audio, { width, height, isAnimated });
				console.info(`[STEAL] Sound sticker relay returned (message ID: ${messageId}).`);
				return;
			}
			if (audio) {
				return sendMessageWTyping(from, { text: `The quoted sticker has incomplete audio details. Reply to the original sticker, or use ${msgInfoObj.prefix}stealaudio to supply the sound.` }, { quoted: msg });
			}
			return sendMessageWTyping(from, { sticker: buffer }, { quoted: msg });
		};
		let packName = "TARS";
		let authorName = "jacktheboss220";
		if (args.includes("pack")) packName = args.join(" ").split("pack ")[1]?.split("author")[0] || packName;
		if (args.includes("author")) authorName = args.join(" ").split("author ")[1]?.split("pack")[0] || authorName;

		const stream = await downloadContentFromMessage(sticker, "sticker");
		const chunks = [];
		for await (const chunk of stream) chunks.push(chunk);
		const buffer = Buffer.concat(chunks);

		const media = getRandom(".webp");
		await fs.promises.writeFile(media, buffer);

		const packOrAuthor = args.includes("pack") || args.includes("author");

		let stickerBuffer = buffer;
		try {
			const webpWithMetadata =
				command === "stealn"
					? await WSF.setMetadata(undefined, undefined, media)
					: await WSF.setMetadata(
							packOrAuthor ? packName : evv ? evv : memberData?.customStealText || "TARS",
							packOrAuthor
								? authorName
								: evv
								? ""
								: memberData?.customStealText
								? undefined
								: "jacktheboss220",
							media,
					  );
			stickerBuffer = Buffer.from(webpWithMetadata);
		} catch (error) {
			// webpmux fails on animated/lossless WebP — retry with node-webpmux (pure JS/Wasm)
			try {
				const finalPack = packOrAuthor ? packName : evv || memberData?.customStealText || "TARS";
				const finalAuthor = packOrAuthor
					? authorName
					: evv ? "" : memberData?.customStealText ? undefined : "jacktheboss220";
				stickerBuffer = command === "stealn"
					? buffer
					: await addExifNodeWebpmux(buffer, finalPack, finalAuthor);
			} catch (err2) {
				stickerBuffer = buffer;
			}
		} finally {
			fs.promises.unlink(media).catch(() => {});
		}
		return sendSticker(stickerBuffer);
	} else {
		return sendMessageWTyping(from, { text: `❌ *Reply on Sticker*` }, { quoted: msg });
	}
};

export default () => ({
	cmd: ["steal", "stealn", "stealaudio"],
	desc: "Steal stickers with custom pack and author names or default ones.",
	usage: "steal | steal pack <name> author <name> | stealaudio (reply to a sticker, then an audio file or voice note)",
	handler,
});
