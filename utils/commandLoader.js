import fs from "fs";
import util from "util";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { getCommandOverrides } from "../db/commandOverrides.js";

const readdir = util.promisify(fs.readdir);

// ES module equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const mainPath = path.join(__dirname, "../commands/");

let commandsPublic = {};
let commandsMembers = {};
let commandsAdmins = {};
let commandsOwners = {};

// We need a way to store metadata about commands (aliases and original scope)
// mapping any alias to its metadata
let commandMetadata = {};

const scopeMap = {
	"public": commandsPublic,
	"group": commandsMembers,
	"admin": commandsAdmins,
	"owner": commandsOwners
};

const loadCommands = async (dirPath, commandsObj, cmdDetails, scopeName) => {
	let filenames = await readdir(dirPath);
	for (const file of filenames) {
		if (file.endsWith(".js")) {
			try {
				// Use dynamic import for ESM
				// Convert Windows path to file:// URL for proper ESM import
				const filePath = path.join(dirPath, file);
				const fileUrl = pathToFileURL(filePath).href;
				const module = await import(fileUrl);

				// Commands export a function that returns the command object
				const commandFunc = module.default;
				if (!commandFunc || typeof commandFunc !== "function") {
					if (!scopeName) console.warn(`⚠️ Warning: ${file} does not export a function`);
					continue;
				}

				// Call the function to get the command info
				const cmd_info = commandFunc();

				// Validate command structure
				if (!cmd_info) {
					if (!scopeName) console.warn(`⚠️ Warning: ${file} function returned null/undefined`);
					continue;
				}
				if (!cmd_info.cmd || !Array.isArray(cmd_info.cmd)) {
					if (!scopeName) console.warn(`⚠️ Warning: ${file} has invalid cmd array:`, cmd_info.cmd);
					continue;
				}
				if (!cmd_info.handler || typeof cmd_info.handler !== "function") {
					if (!scopeName) console.warn(`⚠️ Warning: ${file} has invalid handler`);
					continue;
				}

				const explicitScope = cmd_info.originalType;
				const targetScopeName = explicitScope || scopeName;
				const targetDict = explicitScope ? scopeMap[explicitScope] : commandsObj;

				if (cmdDetails) {
					cmdDetails.push({ cmd: cmd_info.cmd, desc: cmd_info.desc, usage: cmd_info.usage });
				}
				for (let c of cmd_info.cmd) {
					targetDict[c] = cmd_info.handler;
					if (cmd_info.handlesDMs) {
						targetDict[c].handlesDMs = true;
					}
					// Save metadata only during the primary load
					if (scopeName) {
						commandMetadata[c] = {
							aliases: cmd_info.cmd,
							originalType: targetScopeName,
							handler: cmd_info.handler
						};
					}
				}
			} catch (error) {
				console.error(`❌ Error loading ${file}:`, error.message);
			}
		}
	}
};

const deleteFiles = async (dirPath, extensions) => {
	let filenames = await readdir(dirPath);
	filenames.forEach((file) => {
		if (extensions.some((ext) => file.endsWith(ext))) {
			fs.unlinkSync(dirPath + file);
		}
	});
};

const BLACKLIST = ["setcommand", "resetcommand", "test", "code", "group", "member", "bot"];

const setCommandScope = (cmd, newScope, fromDbLoad = false) => {
	const meta = commandMetadata[cmd];
	if (!meta) return null;
	if (BLACKLIST.includes(meta.aliases[0]) || BLACKLIST.some(b => meta.aliases.includes(b))) return null;
	const targetDict = scopeMap[newScope];
	if (!targetDict) return null;

	// Remove from all current scopes
	for (let dict of Object.values(scopeMap)) {
		for (let alias of meta.aliases) {
			delete dict[alias];
		}
	}

	// Add to new scope
	for (let alias of meta.aliases) {
		targetDict[alias] = meta.handler;
	}

	return {
		primaryAlias: meta.aliases[0],
		aliases: meta.aliases,
		originalType: meta.originalType,
		handler: meta.handler
	};
};

const resetCommandScope = (cmd) => {
	const meta = commandMetadata[cmd];
	if (!meta) return null;
	if (BLACKLIST.includes(meta.aliases[0]) || BLACKLIST.some(b => meta.aliases.includes(b))) return null;
	
	const targetDict = scopeMap[meta.originalType];
	if (!targetDict) return null;

	// Remove from all current scopes
	for (let dict of Object.values(scopeMap)) {
		for (let alias of meta.aliases) {
			delete dict[alias];
		}
	}

	// Add back to original scope
	for (let alias of meta.aliases) {
		targetDict[alias] = meta.handler;
	}

	return {
		primaryAlias: meta.aliases[0],
		aliases: meta.aliases,
		originalType: meta.originalType
	};
};

const getCommandOriginalScope = (cmd) => {
	return commandMetadata[cmd]?.originalType || null;
};

const addCommands = async () => {
	console.log("📦 Loading commands...");
	await loadCommands(mainPath + "public/", commandsPublic, [], "public");
	console.log(`✅ Loaded ${Object.keys(commandsPublic).length} public commands`);
	await loadCommands(mainPath + "group/members/", commandsMembers, [], "group");
	console.log(`✅ Loaded ${Object.keys(commandsMembers).length} member commands`);
	await loadCommands(mainPath + "group/admins/", commandsAdmins, [], "admin");
	console.log(`✅ Loaded ${Object.keys(commandsAdmins).length} admin commands`);
	await loadCommands(mainPath + "owner/", commandsOwners, [], "owner");
	console.log(`✅ Loaded ${Object.keys(commandsOwners).length} owner commands`);

	// Apply database overrides
	try {
		const overrides = await getCommandOverrides();
		let appliedCount = 0;
		for (let override of overrides) {
			const res = setCommandScope(override.commandKey, override.effectiveType, true);
			if (res) appliedCount++;
		}
		if (appliedCount > 0) {
			console.log(`✅ Applied ${appliedCount} command scope overrides from database`);
		}
	} catch (err) {
		console.error("❌ Failed to apply command overrides:", err);
	}

	await deleteFiles("./", [".webp", ".jpeg", ".jpg", ".mp3", ".mp4", ".png", ".gif"]);
	console.log("🎉 All commands loaded successfully!");
};

let commandsLoaded = false;
const commandsReadyPromise = addCommands().then(() => { commandsLoaded = true; });

const cmdToText = async () => {
	let adminCommands = [];
	let publicCommands = [];
	let groupCommands = [];
	let ownerCommands = [];
	let directCommands = [];
	await loadCommands(mainPath + "public/", {}, directCommands);
	await loadCommands(mainPath + "public/", {}, publicCommands);
	await loadCommands(mainPath + "group/members/", {}, groupCommands);
	await loadCommands(mainPath + "group/admins/", {}, adminCommands);
	await loadCommands(mainPath + "owner/", {}, ownerCommands);
	return { publicCommands, groupCommands, adminCommands, ownerCommands, directCommands };
};

export { 
	commandsPublic, 
	commandsMembers, 
	commandsAdmins, 
	commandsOwners, 
	cmdToText, 
	commandsReadyPromise, 
	commandsLoaded,
	setCommandScope,
	resetCommandScope,
	getCommandOriginalScope
};
