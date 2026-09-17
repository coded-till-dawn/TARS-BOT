import axios from "axios";

const handler = async (sock, msg, from, args, msgInfoObj) => {
	const { prefix, sendMessageWTyping } = msgInfoObj;

	if (args.length === 0) {
		return sendMessageWTyping(from, { text: `❌ URL is empty! \nSend ${prefix}insta url` }, { quoted: msg });
	}

	let urlInstagram = args[0];

	if (
		!(
			urlInstagram.includes("instagram.com/") ||
			urlInstagram.includes("instagram.com/p/") ||
			urlInstagram.includes("instagram.com/reel/") ||
			urlInstagram.includes("instagram.com/tv/")
		)
	) {
		return sendMessageWTyping(
			from,
			{ text: `❌ Wrong URL! Only Instagram posted videos, tv and reels can be downloaded.` },
			{ quoted: msg }
		);
	}

	if (urlInstagram.includes("?")) {
		urlInstagram = urlInstagram.split("/?")[0].split("?")[0];
	}

	const apiKey = process.env.APIDIRECT_KEY;
	if (!apiKey) {
		return sendMessageWTyping(from, { text: `❌ APIDIRECT_KEY is not configured in .env` }, { quoted: msg });
	}

	try {
		const response = await axios.get("https://apidirect.io/v1/instagram/post", {
			params: { url: urlInstagram },
			headers: { "X-API-Key": apiKey },
		});

		const post = response.data?.post;

		if (!post) {
			return sendMessageWTyping(from, { text: `❌ Couldn't extract media from this Instagram post.` }, { quoted: msg });
		}

		// Helper to send individual media
		const sendMedia = async (mediaObj) => {
			if (mediaObj.is_video === true && mediaObj.video_url) {
				await sendMessageWTyping(from, { video: { url: mediaObj.video_url } }, { quoted: msg });
			} else if (mediaObj.url) {
				await sendMessageWTyping(from, { image: { url: mediaObj.url } }, { quoted: msg });
			}
		};

		if (post.carousel_media && Array.isArray(post.carousel_media) && post.carousel_media.length > 0) {
			// Handle carousel (multiple images/videos)
			for (const item of post.carousel_media) {
				await sendMedia(item);
				// Small delay to prevent rate limits/message flooding
				await new Promise((resolve) => setTimeout(resolve, 1000));
			}
		} else {
			// Handle single image/video
			await sendMedia(post);
		}

	} catch (err) {
		const status = err.response?.status;
		if (status === 401 || status === 403) {
			sendMessageWTyping(from, { text: `❌ Authentication failed with API Direct.` }, { quoted: msg });
		} else if (status === 404) {
			sendMessageWTyping(from, { text: `❌ Post not found or is private.` }, { quoted: msg });
		} else if (status === 429) {
			sendMessageWTyping(from, { text: `❌ Rate limit exceeded. Try again later.` }, { quoted: msg });
		} else {
			console.error("API Direct Instagram Error:", err?.response?.data || err.message);
			sendMessageWTyping(from, { text: `❌ Error fetching Instagram media.` }, { quoted: msg });
		}
	}
};

export default () => ({
	cmd: ["insta", "i"],
	desc: "Download Instagram post",
	usage: "insta | i <url>",
	handler,
});
