import axios from "axios";

const handler = async (sock, msg, from, args, msgInfoObj) => {
	const { sendMessageWTyping } = msgInfoObj;
	const proURl = "https://raw.githubusercontent.com/fortrabbit/quotes/master/quotes.json";
	await axios(proURl)
		.then((res) => {
			const quotes = res.data;
			if (!Array.isArray(quotes) || quotes.length === 0) throw new Error("Invalid quotes data");
			const randomQuote = quotes[Math.floor(Math.random() * quotes.length)];
			let mess = `💻 *Programming Quote*\n\n_"${randomQuote.text}"_\n\n— *${randomQuote.author}*`;
			sendMessageWTyping(from, { text: mess }, { quoted: msg });
		})
		.catch((err) => {
			sendMessageWTyping(from, { text: "Failed to fetch programming quote." }, { quoted: msg });
			console.log("Error in proquote:", err.message);
		});
};

export default () => ({
	cmd: ["proquote", "pqoute"],
	desc: "Get random programming quote",
	usage: "proquote",
	handler,
});
