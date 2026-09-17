const handler = async (sock, msg, from, args, msgInfoObj) => {
	const { sendMessageWTyping } = msgInfoObj;

	const text = `*👨‍💻 Developer — Abhinav Gupta*

╭───────────────────────────
│ *🔗 GitHub*
│ github.com/coded-till-dawn
│
│ *🌐 Portfolio*
│ abhinav77.netlify.app
╰───────────────────────────`;

	await sendMessageWTyping(from, { text }, { quoted: msg });
};

export default () => ({
	cmd: ["dev", "developer"],
	desc: "Developer info",
	usage: "dev | developer",
	handler,
});
