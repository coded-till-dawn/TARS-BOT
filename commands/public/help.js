import dotenv from "dotenv";
dotenv.config();

import { cmdToText } from "../../utils/commandLoader.js";
import { readFileSync } from "fs";

let pkgVersion = "3.0.0";
try {
	const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url)));
	pkgVersion = pkg.version || "3.0.0";
} catch (err) {}

const handler = async (sock, msg, from, args, msgInfoObj) => {
	let { isGroup, sendMessageWTyping, updateName } = msgInfoObj;
	let prefix = process.env.PREFIX || "-";

	const cmds = await cmdToText();
	const { publicCommands, groupCommands, adminCommands, ownerCommands } = cmds;

	// Single command lookup
	if (args.length > 0) {
		const query = args[0].toLowerCase().replace(/^[-/]/, "");
		const all = [...publicCommands, ...groupCommands, ...adminCommands, ...ownerCommands];
		const found = all.find((c) => c.cmd.includes(query));
		if (!found) {
			return sendMessageWTyping(from, { text: `❌ No command found: *${query}*` }, { quoted: msg });
		}
		const aliases = found.cmd.filter((c) => c !== found.cmd[0]).map((c) => `${prefix}${c}`).join("  |  ");
		const text =
			`📖 *${prefix}${found.cmd[0]}*\n\n` +
			`*Description:* ${found.desc}\n` +
			`*Usage:* \`${prefix}${found.usage}\`` +
			(aliases ? `\n*Aliases:* ${aliases}` : "");
		return sendMessageWTyping(from, { text }, { quoted: msg });
	}

	// Main Help Menu Categorization
	const categories = {
		"AI COMMAND": { keywords: ["tars", "gemini", "ai", "chatbot", "gpt", "vision", "imagine"], items: [] },
		"MEDIA COMMAND": { keywords: ["ytdl", "yta", "ytv", "song", "video", "image", "sticker", "removebg", "play", "music", "mp3", "mp4", "ig", "insta", "twitter", "fb", "tiktok"], items: [] },
		"GAMES COMMAND": { keywords: ["game", "xo", "chess", "trivia", "quiz", "guess"], items: [] },
		"FUN COMMAND": { keywords: ["joke", "meme", "quote", "fact", "roast", "fun", "love", "truth", "dare"], items: [] },
		"ANIME COMMAND": { keywords: ["anime", "manga", "waifu", "husbando", "neko"], items: [] },
		"UTILITY COMMAND": { keywords: ["weather", "wiki", "dict", "translate", "tr", "calc", "search", "google", "remind", "timer", "ping", "alive"], items: [] },
	};

	const fallbackCats = {
		"ADMIN COMMAND": [],
		"OWNER COMMAND": [],
		"GROUP COMMAND": [],
		"GENERAL COMMAND": []
	};

	const addToCat = (cmdItem, defaultCat) => {
		const descWords = (cmdItem.desc || "").toLowerCase().split(/[^a-z0-9]+/);
		for (const [catName, catData] of Object.entries(categories)) {
			// Match exact command alias OR exact word in description
			if (cmdItem.cmd.some(alias => catData.keywords.includes(alias)) || 
				catData.keywords.some(kw => descWords.includes(kw))) {
				catData.items.push(cmdItem);
				return;
			}
		}
		fallbackCats[defaultCat].push(cmdItem);
	};

	// 1. Calculate true global registered command count based on modules loaded
	const totalCommands = publicCommands.length + groupCommands.length + adminCommands.length + ownerCommands.length;
	
	// 2. Map commands explicitly. 
	// Public goes to general/categorized, Group goes to group/categorized.
	// Admin and Owner go DIRECTLY to their respective buckets (never entering keyword matcher).
	publicCommands.forEach(c => addToCat(c, "GENERAL COMMAND"));
	
	if (isGroup) {
		groupCommands.forEach(c => addToCat(c, "GROUP COMMAND"));
		adminCommands.forEach(c => fallbackCats["ADMIN COMMAND"].push(c));
	}
	
	// Owners often use DMs, show owner commands globally
	ownerCommands.forEach(c => fallbackCats["OWNER COMMAND"].push(c));

	let helpText = `╭━━『 *TARS Bot* 』━━╮\n\n`;
	helpText += `👋 Hello ${updateName || "User"}!\n\n`;
	helpText += `⚡ Prefix: ${prefix}\n`;
	helpText += `📦 Total Commands: ${totalCommands}\n`;
	helpText += `👑 Owner: Abhinav Gupta\n\n`;

	const finalCats = {
		...Object.fromEntries(Object.entries(categories).map(([k, v]) => [k, v.items])),
		...fallbackCats
	};

	for (const [catName, items] of Object.entries(finalCats)) {
		if (items.length === 0) continue;
		
		// Sort alphabetically by primary command
		items.sort((a, b) => a.cmd[0].localeCompare(b.cmd[0]));
		
		helpText += `┏━━━━━━━━━━━━━━━━━\n`;
		helpText += `┃ 🧭 ${catName}\n`;
		helpText += `┗━━━━━━━━━━━━━━━━━\n\n`;
		
		items.forEach(cmd => {
			helpText += `│ ➜ ${prefix}${cmd.cmd[0]}\n`;
		});
		helpText += `\n`;
	}

	helpText += `💡 Type ${prefix}help <command> for more info\n`;
	helpText += `🌟 Bot Version: ${pkgVersion}`;

	await sendMessageWTyping(from, {
		image: { url: "public/tars.jpg" },
		caption: helpText
	}, { quoted: msg });
};

export default () => ({
	cmd: ["help", "menu"],
	desc: "Help menu",
	usage: "help [command]",
	handler,
});
