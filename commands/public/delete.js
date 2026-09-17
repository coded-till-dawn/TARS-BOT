import { extractPhoneNumber, getPNFromLID } from "../../utils/lid.js";

const handler = async (sock, msg, from, args, msgInfoObj) => {
	const { botNumber, sendMessageWTyping, groupAdmins, senderJid, extendedMessageOriginal, isGroup, isBotMessageId } = msgInfoObj;

	try {
		// 1. First verify a message was replied to and has an ID
		if (!extendedMessageOriginal || !extendedMessageOriginal.stanzaId) {
			return sendMessageWTyping(from, { text: `❌ Tag a message to delete.` }, { quoted: msg });
		}

		const participant = extendedMessageOriginal.participant;
		let isBotMessage = false;

		// 2. Determine bot message ownership safely without assuming missing participant === bot
		if (participant) {
			let normalizedParticipant = participant;
			if (participant.includes("@lid")) {
				normalizedParticipant = getPNFromLID(sock, participant) || participant;
			}
			
			const botJids = [
				botNumber[0],
				botNumber[1],
				sock.user?.id,
				sock.user?.lid
			].filter(Boolean);

			isBotMessage = botJids.some((jid) =>
				extractPhoneNumber(normalizedParticipant) === extractPhoneNumber(jid)
			);
		}
		
		// Fallback: If participant checks failed or were skipped, use cache lookup to verify ownership.
		if (!isBotMessage && isBotMessageId && isBotMessageId(from, extendedMessageOriginal.stanzaId)) {
			isBotMessage = true;
		}

		// 3. Permission checks for other users' messages
		if (!isBotMessage) {
			if (!isGroup) {
				return sendMessageWTyping(
					from,
					{ text: `❌ You cannot delete someone else's message in a private chat.` },
					{ quoted: msg }
				);
			}

			const senderIsAdmin = groupAdmins.includes(senderJid);
			const isBotAdmin = groupAdmins.includes(botNumber[0]) || groupAdmins.includes(botNumber[1]);

			if (!senderIsAdmin) {
				return sendMessageWTyping(
					from,
					{ text: `❌ Only admins can delete others' messages.` },
					{ quoted: msg }
				);
			}
			if (!isBotAdmin) {
				return sendMessageWTyping(
					from,
					{ text: `❌ Bot needs to be admin to delete others' messages.` },
					{ quoted: msg }
				);
			}
		}

		// 4. Prepare and send delete payload
		const options = {
			remoteJid: from,
			fromMe: false,
			id: extendedMessageOriginal.stanzaId,
			participant: extendedMessageOriginal.participant,
		};

		if (isBotMessage) {
			options.fromMe = true;
			delete options.participant;
		}

		await sendMessageWTyping(from, { delete: options });
	} catch (err) {
		console.error("Error deleting message:", err);
		sendMessageWTyping(from, { text: `❌ Error deleting message: ${err.toString()}` }, { quoted: msg });
	}
};

export default () => ({
	cmd: ["delete", "d", "dd"],
	desc: "Delete a message",
	usage: "delete <reply to message>",
	handler,
});
