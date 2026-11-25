import { randomBytes } from "node:crypto";
import { downloadContentFromMessage, prepareWAMessageMedia, proto } from "baileys";
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

let protoPatched = false;
function ensureAudioStickerProtoSupport() {
  if (protoPatched) return;
  protoPatched = true;

  const StickerProto = proto?.Message?.StickerMessage;
  const AudioProto = proto?.Message?.AudioMessage;
  const FutureProofProto = proto?.Message?.FutureProofMessage;
  const MsgProto = proto?.Message;

  if (!StickerProto || !AudioProto || !MsgProto) return;

  // 1. Patch StickerMessage.audioMessage (field 26, wireType 2 -> tag 210)
  if (!("audioMessage" in StickerProto.prototype)) {
    const origStickerFromObj = StickerProto.fromObject.bind(StickerProto);
    const origStickerEncode = StickerProto.encode.bind(StickerProto);

    StickerProto.fromObject = function (object) {
      const msg = origStickerFromObj(object);
      if (object && object.audioMessage != null) {
        msg.audioMessage = AudioProto.fromObject(object.audioMessage);
      }
      return msg;
    };

    StickerProto.encode = function (message, writer) {
      const w = origStickerEncode(message, writer);
      if (message && message.audioMessage != null) {
        AudioProto.encode(message.audioMessage, w.uint32(210).fork()).ldelim();
      }
      return w;
    };
  }

  // 2. Patch Message.audioStickerMessage (field 134, FutureProofMessage, wireType 2 -> tag 1074)
  if (FutureProofProto && !("audioStickerMessage" in MsgProto.prototype)) {
    const origMsgFromObj = MsgProto.fromObject.bind(MsgProto);
    const origMsgEncode = MsgProto.encode.bind(MsgProto);

    MsgProto.fromObject = function (object) {
      const msg = origMsgFromObj(object);
      if (object && object.audioStickerMessage != null) {
        msg.audioStickerMessage = FutureProofProto.fromObject(object.audioStickerMessage);
      }
      return msg;
    };

    MsgProto.encode = function (message, writer) {
      const w = origMsgEncode(message, writer);
      if (message && message.audioStickerMessage != null) {
        FutureProofProto.encode(message.audioStickerMessage, w.uint32(1074).fork()).ldelim();
      }
      return w;
    };
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
	const message = proto.Message.fromObject({
		audioStickerMessage: { message: { stickerMessage } },
	});
	await sock.relayMessage(jid, message, {
		messageId: "3EB0" + randomBytes(18).toString("hex").toUpperCase(),
		additionalAttributes: { type: "media" },
	});
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
	try {
		directory = await mkdtemp(join(tmpdir(), "tars-stiksound-"));
		const input = join(directory, "input");
		const sticker = join(directory, "sticker.webp");
		const audio = join(directory, "audio.ogg");
		const stream = await downloadContentFromMessage(video, "video");
		await writeFile(input, await readLimited(stream, maxMediaBytes));

		await run(process.env.FFMPEG_PATH || ffmpegPath || "ffmpeg", [
			"-nostdin", "-v", "error", "-xerror", "-filter_threads", "1",
			"-protocol_whitelist", "file", "-format_whitelist", "mov,matroska,webm", "-i", input,
			"-map", "0:a:0", "-t", "5", "-c:a", "libopus", "-ac", "1", "-b:a", "64k", audio,
			"-map", "0:v:0", "-t", "5",
			"-vf", "fps=12,scale=512:512:force_original_aspect_ratio=increase,crop=512:512,setsar=1",
			"-c:v", "libwebp_anim", "-pix_fmt", "yuv420p", "-q:v", "45", "-loop", "0", sticker,
		], { timeout: 30000, killSignal: "SIGKILL" });

		const webp = await readFile(sticker);
		if (webp.length > 990 * 1024) {
			return reply({ text: "The animated sticker is too large. Try a shorter clip." });
		}
		await sendSoundSticker(sock, from, webp, await readFile(audio));
	} catch (error) {
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
	desc: "Try sending a WhatsApp sticker with the video’s original audio.",
	usage: "sos | reply to a video or use as its caption",
	handler,
});
