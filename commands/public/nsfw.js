import axios from "axios";
import FormData from "form-data";
import { downloadContentFromMessage } from "baileys";

const handler = async (sock, msg, from, args, msgInfoObj) => {
	const { type, content, sendMessageWTyping, extendedMessageOriginal } = msgInfoObj;

	if (!process.env.SIGHTENGINE_USER || !process.env.SIGHTENGINE_SECRET) {
		return sendMessageWTyping(from, { text: `*❌ SIGHTENGINE_USER or SIGHTENGINE_SECRET is not configured in .env*` }, { quoted: msg });
	}

	const isTaggedImage = type === "extendedTextMessage" && content.includes("imageMessage");

	if (!isTaggedImage && !msg.message.imageMessage) {
		return sendMessageWTyping(from, { text: `*❌ Please reply to an image with -nsfw.*` }, { quoted: msg });
	}

	let downloadFilePath;
	if (msg.message.imageMessage) {
		downloadFilePath = msg.message.imageMessage;
	} else {
		downloadFilePath = extendedMessageOriginal?.quotedMessage?.imageMessage;
	}

	try {
		const stream = await downloadContentFromMessage(downloadFilePath, "image");
		let buffer = Buffer.from([]);
		for await (const chunk of stream) {
			buffer = Buffer.concat([buffer, chunk]);
		}

		const formData = new FormData();
		formData.append("media", buffer, "image.jpg");
		formData.append("models", "nudity-2.1");
		formData.append("api_user", process.env.SIGHTENGINE_USER);
		formData.append("api_secret", process.env.SIGHTENGINE_SECRET);

		const response = await axios({
			method: "post",
			url: "https://api.sightengine.com/1.0/check.json",
			data: formData,
			headers: formData.getHeaders(),
		});

		const nudity = response.data?.nudity;
		if (!nudity) {
			throw new Error("Invalid response structure from Sightengine");
		}

		const classes = [
			{ name: "Safe", key: "none" },
			{ name: "Mildly Suggestive", key: "mildly_suggestive" },
			{ name: "Suggestive", key: "suggestive" },
			{ name: "Very Suggestive", key: "very_suggestive" },
			{ name: "Erotica", key: "erotica" },
			{ name: "Sexual Display", key: "sexual_display" },
			{ name: "Sexual Activity", key: "sexual_activity" }
		];

		let maxScore = -1;
		let primaryClass = null;

		for (const c of classes) {
			const score = nudity[c.key];
			if (score !== undefined && score >= maxScore) {
				maxScore = score;
				primaryClass = c.name;
			}
		}

		if (!primaryClass) {
			throw new Error("Missing required nudity fields from Sightengine");
		}

		const formatPercent = (val) => val != null ? `${(val * 100).toFixed(1)}%` : "0.0%";

		let text = `🔎 *NSFW Analysis*\n\n`;
		text += `Classification: ${primaryClass.toUpperCase()}\n`;
		text += `Confidence: ${formatPercent(maxScore)}\n`;

		if (primaryClass !== "Safe" && nudity.suggestive_classes) {
			const suggestiveClasses = nudity.suggestive_classes;
			
			const classNames = {
				visibly_undressed: "Visibly Undressed",
				sextoy: "Sex Toy",
				suggestive_focus: "Suggestive Focus",
				suggestive_pose: "Suggestive Pose",
				lingerie: "Lingerie",
				male_underwear: "Male Underwear",
				cleavage: "Cleavage",
				"cleavage_categories.very_revealing": "Very Revealing Cleavage",
				"cleavage_categories.revealing": "Revealing Cleavage",
				male_chest: "Male Chest",
				"male_chest_categories.very_revealing": "Very Revealing Male Chest",
				"male_chest_categories.revealing": "Revealing Male Chest",
				"male_chest_categories.slightly_revealing": "Slightly Revealing Male Chest",
				nudity_art: "Nudity Art",
				schematic: "Schematic",
				bikini: "Bikini",
				swimwear_one_piece: "One-Piece Swimwear",
				swimwear_male: "Male Swimwear",
				minishort: "Minishort",
				miniskirt: "Miniskirt",
				other: "Other"
			};

			let maxClassScore = -1;
			let detectedClass = null;

			const flatClasses = { ...suggestiveClasses };
			if (suggestiveClasses.cleavage_categories) {
				Object.entries(suggestiveClasses.cleavage_categories).forEach(([k, v]) => {
					flatClasses[`cleavage_categories.${k}`] = v;
				});
			}
			if (suggestiveClasses.male_chest_categories) {
				Object.entries(suggestiveClasses.male_chest_categories).forEach(([k, v]) => {
					flatClasses[`male_chest_categories.${k}`] = v;
				});
			}

			for (const [key, score] of Object.entries(flatClasses)) {
				if (typeof score !== "number" || key === "none") continue;

				if (score > maxClassScore && score > 0.01) {
					maxClassScore = score;
					detectedClass = classNames[key] || key;
				}
			}

			if (detectedClass) {
				text += `Detected: ${detectedClass}\n`;
			}
		}

		await sendMessageWTyping(from, { text: text.trim() }, { quoted: msg });

	} catch (err) {
		console.error("Sightengine API Error:", err?.response?.data || err.message);
		sendMessageWTyping(from, { text: `*❌ Error analyzing image. Please try again later.*` }, { quoted: msg });
	}
};

export default () => ({
	cmd: ["nsfw"],
	desc: "Get the NSFW percentage of an image",
	usage: "nsfw <reply to image>",
	handler,
});
