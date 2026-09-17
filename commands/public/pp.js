const handler = async (sock, msg, from, args, msgInfoObj) => {
	const { sendMessageWTyping, extendedMessageOriginal } = msgInfoObj;

	const targetJid = extendedMessageOriginal?.mentionedJid?.[0] || extendedMessageOriginal?.participant;

	if (!targetJid) {
		return sendMessageWTyping(
			from,
			{ text: `*❌ Please reply to a user's message or mention a user to fetch their profile picture.*` },
			{ quoted: msg }
		);
	}

	try {
		const profilePicUrl = await sock.profilePictureUrl(targetJid, "image");
		await sendMessageWTyping(
			from,
			{ image: { url: profilePicUrl } },
			{ quoted: msg }
		);
	} catch (err) {
		sendMessageWTyping(
			from,
			{ text: `*❌ This user's profile picture is hidden or not set.*` },
			{ quoted: msg }
		);
	}
};

export default () => ({
	cmd: ["pp"],
	desc: "Get user's WhatsApp profile picture",
	usage: "pp <reply to message> | pp @user",
	handler,
});
