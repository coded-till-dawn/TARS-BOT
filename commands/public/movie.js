import axios from "axios";

const handler = async (sock, msg, from, args, msgInfoObj) => {
	const { sendMessageWTyping } = msgInfoObj;

	if (!process.env.TMDB_API_KEY) {
		return sendMessageWTyping(from, { text: `*❌ TMDB_API_KEY is not configured in .env*` }, { quoted: msg });
	}

	const query = args.join(" ").trim();
	if (!query) {
		return sendMessageWTyping(from, { text: `*❌ Please provide a movie title. Example: -movie Interstellar*` }, { quoted: msg });
	}

	try {
		// 1. Search Movie
		const searchRes = await axios.get("https://api.themoviedb.org/3/search/movie", {
			headers: {
				Authorization: `Bearer ${process.env.TMDB_API_KEY}`,
			},
			params: {
				query: query,
				include_adult: false,
				language: "en-US",
			},
		});

		if (!searchRes.data || !searchRes.data.results || searchRes.data.results.length === 0) {
			return sendMessageWTyping(from, { text: `*❌ No movie found for that title.*` }, { quoted: msg });
		}

		const movie = searchRes.data.results[0];
		const { id, title, release_date, vote_average, overview, poster_path } = movie;

		// 2. Get Watch Providers
		const providersRes = await axios.get(`https://api.themoviedb.org/3/movie/${id}/watch/providers`, {
			headers: {
				Authorization: `Bearer ${process.env.TMDB_API_KEY}`,
			},
		});

		const inProviders = providersRes.data?.results?.IN;
		
		let watchText = `▶️ *Where to watch in India:*\n`;
		let hasProviders = false;
		let tmdbLink = "";

		if (inProviders) {
			tmdbLink = inProviders.link || "";
			
			const formatProviders = (type, label) => {
				if (inProviders[type] && inProviders[type].length > 0) {
					// Deduplicate by provider_name
					const names = [...new Set(inProviders[type].map(p => p.provider_name))];
					watchText += `• ${label}: ${names.join(", ")}\n`;
					hasProviders = true;
				}
			};

			formatProviders("flatrate", "Streaming");
			formatProviders("rent", "Rent");
			formatProviders("buy", "Buy");
		}

		if (!hasProviders) {
			watchText += `Not available on Indian digital platforms right now.\n`;
		}

		let caption = `🎬 *${title}*\n\n`;
		caption += `📅 Release: ${release_date || "Unknown"}\n`;
		caption += `⭐ Rating: ${vote_average ? vote_average.toFixed(1) : "N/A"}/10\n\n`;
		caption += `📝 Overview:\n${overview || "No overview available."}\n\n`;
		caption += `${watchText}\n`;
		
		if (tmdbLink) {
			caption += `🔗 Watch: ${tmdbLink}\n\n`;
		}
		
		caption += `_Data provided by TMDB. Availability by JustWatch._`;

		if (poster_path) {
			const posterUrl = `https://image.tmdb.org/t/p/w500${poster_path}`;
			await sendMessageWTyping(from, { image: { url: posterUrl }, caption: caption }, { quoted: msg });
		} else {
			await sendMessageWTyping(from, { text: caption }, { quoted: msg });
		}

	} catch (err) {
		console.error("TMDB API Error:", err?.response?.data || err.message);
		sendMessageWTyping(from, { text: `*❌ Error fetching movie data. Please try again later.*` }, { quoted: msg });
	}
};

export default () => ({
	cmd: ["movie"],
	desc: "Get movie details and watch providers in India",
	usage: "movie <title>",
	handler,
});
