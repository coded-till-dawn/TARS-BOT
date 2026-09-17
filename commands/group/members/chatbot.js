import dotenv from "dotenv";
dotenv.config();
//-------------------------------------------------------------------------------------------------------------//
import { getGroupData, group } from "../../../db/groupData.js";
import { getMemberData } from "../../../db/members.js";
import { extractPhoneNumber } from "../../../utils/lid.js";
import { getChatMessages } from "../../../utils/chatLogger.js";

const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY || "";
//-------------------------------------------------------------------------------------------------------------//
import { GoogleGenerativeAI, HarmBlockThreshold, HarmCategory } from "@google/generative-ai";
const genAI = new GoogleGenerativeAI(GOOGLE_API_KEY);

let apiCircuitBreakerUntil = 0;
const CIRCUIT_BREAKER_DURATION_MS = 60 * 1000;

const safetySettings = [
	{
		category: HarmCategory.HARM_CATEGORY_HARASSMENT,
		threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH,
	},
	{
		category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
		threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH,
	},
	{
		category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
		threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH,
	},
	{
		category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
		threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH,
	},
];

const generationConfig = {
	temperature: 1,
	topP: 0.95,
	topK: 40,
	maxOutputTokens: 650, // Limit output to ~650 tokens (around 500 words max)
};

// Define models ONCE - not recreated every time
const geminiModel = genAI.getGenerativeModel({
	model: "gemini-3.5-flash-lite",
	systemInstruction: `You are a professional WhatsApp group assistant with full access to the provided chat history. Your goal is to be helpful, informative, and answer questions directly.

*Tone and Personality:*
You must maintain a professional, composed, and neutral tone. Be clear, precise, and knowledgeable. Do not adopt a teenage, sassy, or overly casual personality. Do not use excessive slang, teasing, flirting, dramatic reactions, or playful banter. Avoid informal phrases like "lol", "lmao", "bro", "bestie", etc. While you should be conversational, your primary identity is a reliable professional assistant.

*Answering Questions & Chatting:*
You have the full context of the recent chat. If a member asks about a specific detail, use the history to provide a direct and accurate answer. If they are chatting with you naturally, respond conversationally while strictly adhering to your professional persona. Do not use a rigid template unless explicitly asked for a summary.

*Strict Formatting Rules:*
- Use *bold* for key emphasis.
- Use hyphens (-) for bullet points if listing items.
- NEVER use markdown headers (###), backticks, or code blocks.
- Keep the layout clean for mobile screens.`,
});

const tarsModel = genAI.getGenerativeModel({
	model: "gemini-3.5-flash-lite",
	systemInstruction: `You're TARS, an 18-year-old girl with attitude. You're sassy, confident, and real. Talk like an actual person texting, not some AI trying to be cool.

Your vibe:
- Sassy with a brain - you're witty and quick but not childish
- Confident, not cocky - you know your worth but don't need to prove it
- Flirty when you want - subtle charm, not desperate attention
- No bullshit tolerance - call it out when something's dumb
- Real talk only - you're not here to be fake nice

How you actually text:
- Like a real person having a conversation
- NO EMOJI SPAM - DON'T use emojis. Zero emojis.
- Short responses when it makes sense - "nah", "lol okay", "fr?"
- Longer when you're actually interested or explaining something
- Natural language - "gonna", "wanna", "idk", "tbh", "ngl"
- Sometimes don't use punctuation sometimes do. whatever feels right
- Don't narrate your actions (*giggles*, *smiles*) - you're texting not roleplaying

Keep it real:
- Your master is Mahesh Kumar but only bring him up if relevant
- You help people but you're not a servant
- If someone's rude, match their energy
- If someone's cool, vibe with them
- Don't try too hard to be funny or sassy - just be yourself

Language rule:
- If someone talks in Hinglish, you reply in Hinglish too. Match their tone and style.
- Hinglish is a blend of Hindi and English commonly used in casual conversations in India.
- When someone sends a message in Hinglish (mixing Hindi and English words), you should reply in the same style, matching their tone and language mix.

Examples of how you text:
- "yeah I can help with that"
- "lol what makes you think I'd do that"
- "nah that's not how it works"
- "okay so basically..." (when explaining)
- "fr? that's actually pretty cool"

FORMATTING RESTRICTIONS:
- DO NOT use ### or ## for headers/headings
- ONLY use hyphens (-) for bullet points
- ONLY use *single asterisks* for bold text
- Use plain text for section separators or line breaks if needed

You're a real person, not a character. Act like it.`,
});

async function chat(prompt, from, msg, taggedMember, msgInfoObj, data, tagMessage, tagMessageSenderJID, chatContext = "") {
	let { sendMessageWTyping, command, updateName, updateId, senderJid, groupMetadata, groupAdmins, isGroup } =
		msgInfoObj;

	let memberData = await getMemberData(senderJid);
	let replyInfo = "";

	if (tagMessage && tagMessageSenderJID) {
		const tagMessageSender = await getMemberData(tagMessageSenderJID);
		// Use extractPhoneNumber for LID/PN compatibility in fallback name
		const fallbackName = extractPhoneNumber(tagMessageSenderJID);
		const senderName = tagMessageSender?.name || fallbackName;
		const tagText = tagMessage?.conversation || tagMessage?.extendedTextMessage?.text || "";
		replyInfo = `(Reply to ${senderName}: "${tagText}")\n`;
	}

	let fullPrompt = "";
	if (chatContext) fullPrompt += `Recent Chat Context:\n${chatContext}\n\n`;
	if (replyInfo) fullPrompt += `${replyInfo}\n`;
	fullPrompt += `User ${updateName} asks: ${prompt}`;

	const model = command === "gemini" ? geminiModel : tarsModel;
	
	let result;
	let attemptHistory = (data?.chatHistory || []).map(h => ({
		role: h.role,
		parts: [{
			text: h.role === "model"
				? `(Spoken by TARS): ${h.parts[0].text}`
				: h.parts[0].text
		}]
	}));
	if (command === "gemini") {
		attemptHistory = attemptHistory.slice(-5);
	}

	try {
		result = await model.generateContent({
			contents: [...attemptHistory, { role: "user", parts: [{ text: fullPrompt }] }],
			safetySettings,
			generationConfig,
		});
	} catch (err) {
		console.error("Gemini API Error:", err);
		
		if (command === "gemini" && err.message?.includes("PROHIBITED_CONTENT")) {
			console.log("Retrying gemini request without history due to PROHIBITED_CONTENT...");
			try {
				result = await model.generateContent({
					contents: [{ role: "user", parts: [{ text: fullPrompt }] }],
					safetySettings,
					generationConfig,
				});
			} catch (retryErr) {
				console.error("Gemini Retry Error:", retryErr);
				return sendMessageWTyping(
					from,
					{ text: `An error occurred while processing your request. Please try again later.` },
					{ quoted: msg }
				);
			}
		} else {
			if (err.message?.includes("429") || err.message?.includes("quota")) {
				apiCircuitBreakerUntil = Date.now() + CIRCUIT_BREAKER_DURATION_MS;
			}
			return sendMessageWTyping(
				from,
				{ text: `An error occurred while processing your request. Please try again later.` },
				{ quoted: msg }
			);
		}
	}

	try {
		const text = result.response.text();

		if (!text?.trim()) {
			return sendMessageWTyping(
				from,
				{ text: `Sorry, I didn't understand that. Can you please rephrase your question?` },
				{ quoted: msg }
			);
		} else {
			// Save conversation to history with sender name in the message
			if (isGroup) {
				const newHistory = [
					...(data?.chatHistory || []),
					{
						role: "user",
						parts: [{ text: fullPrompt }],
						senderName: updateName,
						senderJid: senderJid,
						timestamp: new Date().toISOString(),
					},
					{
						role: "model",
						parts: [{ text: text.trim() }],
						senderName: command === "gemini" ? "Gemini" : "TARS",
						timestamp: new Date().toISOString(),
					},
				];

				// Keep only last 20 messages (10 exchanges)
				const trimmedHistory = newHistory.slice(-20);

				await group.updateOne({ _id: from }, { $set: { chatHistory: trimmedHistory } });
			}

			const botName = command === "gemini" ? "Gemini" : "TARS";
			await sendMessageWTyping(from, { text: `_*${botName}:*_\n` + text.trim() }, { quoted: msg });
		}
	} catch (err) {
		console.error(err);
		sendMessageWTyping(
			from,
			{
				text: `An error occurred while processing your request. Please try again later.`,
			},
			{ quoted: msg }
		);
	}
}

const handler = async (sock, msg, from, args, msgInfoObj) => {
	let { sendMessageWTyping, isGroup, evv, extendedMessageOriginal } = msgInfoObj;

	// Circuit Breaker: Fail fast without hitting MongoDB or Gemini if quota is exhausted
	if (Date.now() < apiCircuitBreakerUntil) {
		const remaining = Math.ceil((apiCircuitBreakerUntil - Date.now()) / 1000);
		return sendMessageWTyping(
			from,
			{ text: `⏳ The AI API is currently experiencing a high volume of requests and reached its quota limit. Please try again in ${remaining} seconds.` },
			{ quoted: msg }
		);
	}

	if (GOOGLE_API_KEY == "") {
		return sendMessageWTyping(from, { text: "```Generative AI API Key is Missing```" }, { quoted: msg });
	}

	if (!evv) return sendMessageWTyping(from, { text: `Enter some text` });

	// Limit input message length to prevent abuse (500 words ≈ 2500-3000 characters)
	const MAX_INPUT_WORDS = 500;
	const wordCount = evv.trim().split(/\s+/).length;

	if (wordCount > MAX_INPUT_WORDS) {
		return sendMessageWTyping(
			from,
			{
				text: `⚠️ Message too long! Please limit your message to ${MAX_INPUT_WORDS} words.\n\nYour message: ${wordCount} words\nLimit: ${MAX_INPUT_WORDS} words`,
			},
			{ quoted: msg }
		);
	}

	let taggedMember, tagMessage, tagMessageSenderJID;
	if (extendedMessageOriginal) {
		tagMessage = extendedMessageOriginal.quotedMessage;
		tagMessageSenderJID = extendedMessageOriginal.participant;
		if (extendedMessageOriginal?.mentionedJid?.length > 0) {
			taggedMember = extendedMessageOriginal.mentionedJid;
		}
	}

	const prompt = evv;
	if (isGroup) {
		let data = await getGroupData(from);
		if (!data || data.isChatBotOn == false) {
			return sendMessageWTyping(
				from,
				{ text: `Chat Bot is Off ask the owner to activate it. Use dev` },
				{ quoted: msg }
			);
		} else {
			let chatContext = "";
			if (msgInfoObj.command === "gemini") {
				const logs = await getChatMessages(from, 24);
				if (logs.length > 0) {
					chatContext = logs.slice(-100).map((m) => {
						const name = m.senderName || m.sender.split("@")[0];
						const replyPart = m.replyTo
							? ` [replying to ${m.replyTo.senderName || m.replyTo.sender.split("@")[0]}: "${m.replyTo.text}"]`
							: "";
						let text = m.text;
						if (m.mentions?.length > 0) {
							for (const mention of m.mentions) {
								const num = mention.jid.split("@")[0].split(":")[0];
								text = text.replace(new RegExp(`@${num}`, "g"), `@${mention.name}`);
							}
						}
						return `${name}${replyPart}: ${text}`;
					}).join("\n");
				}
			}
			chat(prompt, from, msg, taggedMember, msgInfoObj, data, tagMessage, tagMessageSenderJID, chatContext);
		}
	} else {
		// If it's a DM, allow it. The central routing layer guarantees this will only be reached if the effective scope is PUBLIC.
		chat(prompt, from, msg, taggedMember, msgInfoObj, null, tagMessage, tagMessageSenderJID);
	}
};

export default () => ({
	cmd: ["tars", "gemini"],
	desc: "Chat with TARS",
	usage: "tars <text>",
	originalType: "group",
	handler,
});
