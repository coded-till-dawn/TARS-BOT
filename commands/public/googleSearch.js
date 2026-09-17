import fs from "fs";
import axios from "axios";

const SERPER_API_KEY = process.env.SERPER_API_KEY || "";
const baseURL = "https://google.serper.dev/search";
const maxResults = 5;

const handler = async (sock, msg, from, args, msgInfoObj) => {
	const { sendMessageWTyping, evv, extendedMessageOriginal } = msgInfoObj;

	if (!SERPER_API_KEY) {
		return sendMessageWTyping(
			from,
			{ text: "```Serper API Key is Missing```" },
			{ quoted: msg }
		);
	}

	if (!args[0] && !extendedMessageOriginal) {
		return sendMessageWTyping(from, { text: "```Enter Word to Search```" }, { quoted: msg });
	}

	let searchQuery = evv || extendedMessageOriginal?.quotedMessage?.conversation;

	if (!searchQuery) return sendMessageWTyping(from, { text: "```Enter Word to Search```" }, { quoted: msg });

	try {
		const response = await axios.post(
			baseURL,
			{ q: searchQuery },
			{
				headers: {
					"X-API-KEY": SERPER_API_KEY,
					"Content-Type": "application/json",
				},
			}
		);

		const searchResults = response.data?.organic?.slice(0, maxResults);

		if (searchResults && searchResults.length > 0) {
			let message = "";
			searchResults.forEach((result, index) => {
				message += `*Title*: ${result.title}\n*Snippet*: ${result.snippet}\n*Link*: ${result.link}\n\n`;
			});

			sendMessageWTyping(from, { text: message.trim() }, { quoted: msg });
		} else {
			sendMessageWTyping(from, { text: "```No Results Found```" }, { quoted: msg });
		}
	} catch (error) {
		console.error("Error during Serper search:", error?.response?.data || error.message);
		sendMessageWTyping(from, { text: "```Error occurred while searching```" }, { quoted: msg });
	}
};

export default () => ({
	cmd: ["search", "gs"],
	desc: "Search on Google",
	usage: "search | gs <query>",
	handler,
});
