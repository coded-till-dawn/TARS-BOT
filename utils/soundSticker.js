import { randomBytes } from "node:crypto";
import { prepareWAMessageMedia, proto } from "baileys";

const { StickerMessage, AudioMessage } = proto.Message;
const audioTag = 210; // StickerMessage field 26, length-delimited.

if (!("audioMessage" in StickerMessage.prototype)) {
	const encodeSticker = StickerMessage.encode;
	const decodeSticker = StickerMessage.decode;

	StickerMessage.encode = function (message, writer) {
		const output = encodeSticker(message, writer);
		if (message.audioMessage) {
			AudioMessage.encode(message.audioMessage, output.uint32(audioTag).fork()).ldelim();
		}
		return output;
	};

	StickerMessage.decode = function (reader, length, endTag) {
		// Nested stickers receive a protobuf Reader from the enclosing message.
		if (typeof reader?.uint32 !== "function" || length === undefined) {
			return decodeSticker(reader, length, endTag);
		}
		const start = reader.pos;
		const end = start + length;
		let audioMessage;
		try {
			while (reader.pos < end) {
				const tag = reader.uint32();
				if (tag === audioTag) {
					const audioLength = reader.uint32();
					if (audioLength > end - reader.pos) break;
					audioMessage = AudioMessage.decode(reader, audioLength);
				} else {
					reader.skipType(tag & 7);
				}
			}
		} finally {
			reader.pos = start;
		}
		const sticker = decodeSticker(reader, length, endTag);
		if (audioMessage) sticker.audioMessage = audioMessage;
		return sticker;
	};
}

export async function sendSoundSticker(sock, jid, sticker, audioMessage, dimensions) {
	const { stickerMessage } = await prepareWAMessageMedia({ sticker }, { upload: sock.waUploadToServer });
	Object.assign(stickerMessage, dimensions, { audioMessage });
	const messageId = "3EB0" + randomBytes(18).toString("hex").toUpperCase();
	await sock.relayMessage(jid, { stickerMessage }, { messageId });
	return messageId;
}
