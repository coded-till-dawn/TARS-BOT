import { resetCommandScope } from "../../utils/commandLoader.js";
import { deleteCommandOverride } from "../../db/commandOverrides.js";
import { pushScopeChange } from "../../notify/adminEvents.js";

const BLACKLIST = ["setcommand", "resetcommand", "test", "code", "group", "member", "bot"];

const handler = async (sock, msg, from, args, msgInfoObj) => {
	const { sendMessageWTyping } = msgInfoObj;

	if (args.length < 1) {
		return sendMessageWTyping(from, { text: `❌ Usage: -resetcommand <command>` }, { quoted: msg });
	}

	const cmd = args[0].toLowerCase();

	if (BLACKLIST.includes(cmd)) {
		return sendMessageWTyping(from, { text: `❌ Security Alert: This command is permanently protected.` }, { quoted: msg });
	}

	try {
		// Attempt to reset in memory
		const result = resetCommandScope(cmd);
		
		if (!result) {
			return sendMessageWTyping(from, { text: `❌ Command '${cmd}' not found or has no override.` }, { quoted: msg });
		}

		// Delete from MongoDB
		await deleteCommandOverride(result.primaryAlias);

		// Broadcast to dashboard
		pushScopeChange({
			commandKeys: result.aliases,
			newScope: result.originalType,
			originalScope: result.originalType
		});

		return sendMessageWTyping(from, { text: `✅ Command scope reset!\n*${result.aliases.join(", ")}* is restored to *${result.originalType}*.` }, { quoted: msg });

	} catch (err) {
		console.error("Error in resetcommand:", err);
		return sendMessageWTyping(from, { text: `❌ Failed to reset command scope.` }, { quoted: msg });
	}
};

export default () => ({
	cmd: ["resetcommand"],
	desc: "Reset command scope globally",
	usage: "resetcommand <command>",
	handler,
});
