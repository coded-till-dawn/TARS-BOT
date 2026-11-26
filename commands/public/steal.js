import { findSoundSticker, getSoundSticker, sendSoundSticker } from "../../utils/soundSticker.js";
import { getMemberData } from "../../db/members.js";
import { downloadContentFromMessage, normalizeMessageContent, prepareWAMessageMedia } from "baileys";
import NodeCache from "node-cache";
import WSF from "wa-sticker-formatter";
import nodeWebpmux from "node-webpmux";
const { Image: WebpImage } = nodeWebpmux;

import fs from "fs";
import os from "os";
import path from "path";
const getRandom = (ext) => path.join(os.tmpdir(), `${Math.floor(Math.random() * 10000)}${ext}`);

const pendingStickers = new NodeCache({ stdTTL: 300, checkperiod: 60, useClones: false });

async function readMedia(message, type) {
	const stream = await downloadContentFromMessage(message, type);
	const chunks = [];
	let size = 0;
	for await (const chunk of stream) {
		size += chunk.length;
		if (size > 1024 * 1024) throw new Error("Sticker or voice note exceeds 1 MiB");
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
		return reply(`Sticker selected for five minutes. Reply to an Ogg/Opus voice note of up to 10 seconds with ${command}.`);
	}

	const voiceNote = quoted?.audioMessage;
	const selectedSticker = pendingStickers.get(key);
	if (!voiceNote || !selectedSticker) {
		return reply(`Reply to a sticker with ${command}, then reply to a voice note with the same command.`);
	}
	if (!voiceNote.seconds || voiceNote.seconds > 10 || !/^audio\/ogg(?:;|$)/i.test(voiceNote.mimetype ?? "")) {
		return reply("Use a WhatsApp Ogg/Opus voice note of up to 10 seconds.");
	}

	pendingStickers.del(key);
	try {
		const [visual, audio] = await Promise.all([readMedia(selectedSticker, "sticker"), readMedia(voiceNote, "audio")]);
		if (audio.toString("ascii", 0, 4) !== "OggS" || !audio.subarray(0, 128).includes(Buffer.from("OpusHead"))) {
			throw new Error("Voice note is not Ogg Opus");
		}
		const { audioMessage } = await prepareWAMessageMedia({
			audio,
			mimetype: "audio/ogg; codecs=opus",
			seconds: voiceNote.seconds,
		}, { upload: sock.waUploadToServer });
		const { width, height, isAnimated } = selectedSticker;
		await sendSoundSticker(sock, from, visual, audioMessage, { width, height, isAnimated });
	} catch {
		return reply(`Could not pair the media. Select the sticker again with ${command} and try a fresh voice note.`);
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
	usage: "steal | steal pack <name> author <name> | stealaudio (reply to a sticker, then a voice note)",
	handler,
});
