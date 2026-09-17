import { setCommandScope, getCommandOriginalScope } from "../../utils/commandLoader.js";
import { setCommandOverride } from "../../db/commandOverrides.js";
import { pushScopeChange } from "../../notify/adminEvents.js";

const BLACKLIST = ["setcommand", "resetcommand", "test", "code", "group", "member", "bot"];

const handler = async (sock, msg, from, args, msgInfoObj) => {
	const { sendMessageWTyping } = msgInfoObj;

	if (args.length < 2) {
		return sendMessageWTyping(from, { text: `❌ Usage: -setcommand <command> <public|group|admin|owner>` }, { quoted: msg });
	}

	const cmd = args[0].toLowerCase();
	const newScope = args[1].toLowerCase();

	if (!["public", "group", "admin", "owner"].includes(newScope)) {
		return sendMessageWTyping(from, { text: `❌ Invalid scope! Choose from: public, group, admin, owner` }, { quoted: msg });
	}

	if (BLACKLIST.includes(cmd)) {
		return sendMessageWTyping(from, { text: `❌ Security Alert: This command is permanently protected and cannot be moved from its owner scope.` }, { quoted: msg });
	}

	try {
		// Attempt to set it in memory first, which also looks up the aliases and original scope.
		const result = setCommandScope(cmd, newScope);
		
		if (!result) {
			return sendMessageWTyping(from, { text: `❌ Command '${cmd}' not found.` }, { quoted: msg });
		}

		// Save to MongoDB
		await setCommandOverride(result.primaryAlias, newScope, result.aliases);

		// Broadcast to dashboard
		pushScopeChange({
			commandKeys: result.aliases,
			newScope: newScope,
			originalScope: result.originalType
		});

		return sendMessageWTyping(from, { text: `✅ Command scope changed!\n*${result.aliases.join(", ")}* is now *${newScope}*.` }, { quoted: msg });

	} catch (err) {
		console.error("Error in setcommand:", err);
		return sendMessageWTyping(from, { text: `❌ Failed to update command scope.` }, { quoted: msg });
	}
};

export default () => ({
	cmd: ["setcommand"],
	desc: "Set command scope override globally",
	usage: "setcommand <command> <scope>",
	handler,
});
