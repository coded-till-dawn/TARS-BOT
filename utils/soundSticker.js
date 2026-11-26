import { randomBytes } from "node:crypto";
import NodeCache from "node-cache";
import { normalizeMessageContent, prepareWAMessageMedia, proto } from "baileys";

const { Message } = proto;
const { StickerMessage, AudioMessage, FutureProofMessage } = Message;
const audioTag = 210; // StickerMessage field 26, length-delimited.
const audioStickerTag = 1074; // Message field 134, length-delimited.

function decodeWithAttachment(MessageType, field, fieldTag, AttachmentType) {
	const decode = MessageType.decode;
	MessageType.decode = function (input, length, endTag) {
		// Top-level messages arrive as bytes. Nested messages share the protobuf Reader.
		const isReader = typeof input?.uint32 === "function";
		const start = isReader ? input.pos : 0;
		const message = decode(input, length, endTag);
		const bytes = isReader ? input.buf.subarray(start, input.pos) : input.subarray(0, length);
		let offset = 0;
		const readVarint = () => {
			let value = 0;
			for (let shift = 0; offset < bytes.length && shift < 49; shift += 7) {
				const byte = bytes[offset++];
				value += (byte & 127) * 2 ** shift;
				if (byte < 128) return value;
			}
			return NaN;
		};
		while (offset < bytes.length) {
			const tag = readVarint();
			if (tag % 8 === 2) {
				const size = readVarint();
				if (tag === fieldTag && size <= bytes.length - offset) {
					message[field] = AttachmentType.decode(bytes.subarray(offset, offset + size));
					break;
				}
				offset += size;
			} else if (tag % 8 === 0) {
				while (offset < bytes.length && bytes[offset++] >= 128) {}
			} else if (tag % 8 === 1) {
				offset += 8;
			} else if (tag % 8 === 5) {
				offset += 4;
			} else {
				break;
			}
		}
		return message;
	};
}

if (!("audioMessage" in StickerMessage.prototype)) {
	const encodeSticker = StickerMessage.encode;
	StickerMessage.encode = function (message, writer) {
		const output = encodeSticker(message, writer);
		if (message.audioMessage) {
			AudioMessage.encode(message.audioMessage, output.uint32(audioTag).fork()).ldelim();
		}
		return output;
	};
	decodeWithAttachment(StickerMessage, "audioMessage", audioTag, AudioMessage);
}

if (!("audioStickerMessage" in Message.prototype)) {
	decodeWithAttachment(Message, "audioStickerMessage", audioStickerTag, FutureProofMessage);
}

export function getSoundSticker(content) {
	const normalized = normalizeMessageContent(content);
	return normalized?.audioStickerMessage?.message?.stickerMessage ?? normalized?.stickerMessage;
}

const recentSoundStickers = new NodeCache({ stdTTL: 3600, checkperiod: 300, useClones: false });

export function rememberSoundSticker(jid, messageId, sticker) {
	if (!jid || !messageId || !sticker?.audioMessage) return;
	const key = `${jid}:${messageId}`;
	if (!recentSoundStickers.has(key) && recentSoundStickers.getStats().keys >= 300) {
		recentSoundStickers.del(recentSoundStickers.keys()[0]);
	}
	recentSoundStickers.set(key, sticker);
}

export function findSoundSticker(jid, messageId, quotedSticker) {
	const original = recentSoundStickers.get(`${jid}:${messageId}`);
	if (original || !quotedSticker?.fileEncSha256?.length) return original;

	// Forwarding can change the message ID while keeping the same uploaded image.
	const hash = Buffer.from(quotedSticker.fileEncSha256);
	const candidates = recentSoundStickers.keys().filter((key) => key.startsWith(`${jid}:`));
	const matches = candidates.map((key) => recentSoundStickers.get(key)).filter(
		(sticker) => sticker?.fileEncSha256 && hash.equals(Buffer.from(sticker.fileEncSha256)),
	);
	const first = matches[0];
	if (first?.audioMessage.directPath && matches.every((sticker) => sticker.audioMessage.directPath === first.audioMessage.directPath)) {
		return first;
	}
}

export async function sendSoundSticker(sock, jid, sticker, audioMessage, dimensions) {
	const { stickerMessage } = await prepareWAMessageMedia({ sticker }, { upload: sock.waUploadToServer });
	Object.assign(stickerMessage, dimensions, { audioMessage });
	const messageId = "3EB0" + randomBytes(18).toString("hex").toUpperCase();
	await sock.relayMessage(jid, { stickerMessage }, { messageId });
	rememberSoundSticker(jid, messageId, stickerMessage);
	return messageId;
}
