import { setFeatureState, getFeatureState, listGroupFeatures } from "../../db/featureToggles.js";

// Keep this in sync with the map in core/messages.js
const SUPPORTED_FEATURES = [
	"tars",
	"gemini",
	"nsfw",
	"meme",
	"youtube",
	"instagram",
	"movie",
	"poetry",
	"quotes"
];

const handler = async (sock, msg, from, args, msgInfoObj) => {
	const { sendMessageWTyping, isGroup } = msgInfoObj;

	if (!isGroup) {
		return sendMessageWTyping(from, { text: `❎ This command is only applicable in Groups!` }, { quoted: msg });
	}

	if (!args || args.length === 0) {
		return sendMessageWTyping(from, { text: `*Usage:*\n-toggle <feature> on|off|status\n-toggle list` }, { quoted: msg });
	}

	const featureOrAction = args[0].toLowerCase();

	if (featureOrAction === "list") {
		const overrides = await listGroupFeatures(from);
		let response = `*Group Feature Toggles*\n\n`;
		
		for (const feat of SUPPORTED_FEATURES) {
			const override = overrides.find(o => o.feature === feat);
			// override-only logic: if there's no override or if enabled is true, it's ON.
			// However, our setFeatureState deletes the record if enabled=true, 
			// so any existing record means enabled=false.
			const status = override && !override.enabled ? "OFF ❌" : "ON ✅";
			response += `• *${feat}*: ${status}\n`;
		}
		
		return sendMessageWTyping(from, { text: response }, { quoted: msg });
	}

	const feature = featureOrAction;
	if (!SUPPORTED_FEATURES.includes(feature)) {
		return sendMessageWTyping(from, { text: `❌ Invalid feature: *${feature}*\n\nSupported features:\n${SUPPORTED_FEATURES.join(", ")}` }, { quoted: msg });
	}

	const action = args[1]?.toLowerCase();

	if (action === "status") {
		const state = await getFeatureState(from, feature);
		return sendMessageWTyping(from, { text: `Feature *${feature}* is currently *${state ? "ON ✅" : "OFF ❌"}* in this group.` }, { quoted: msg });
	}

	if (action === "on") {
		await setFeatureState(from, feature, true);
		return sendMessageWTyping(from, { text: `✅ Feature *${feature}* is now *ON* for this group.` }, { quoted: msg });
	} else if (action === "off") {
		await setFeatureState(from, feature, false);
		return sendMessageWTyping(from, { text: `✅ Feature *${feature}* is now *OFF* for this group.` }, { quoted: msg });
	} else {
		return sendMessageWTyping(from, { text: `*Usage:*\n-toggle ${feature} on|off|status` }, { quoted: msg });
	}
};

export default () => ({
	cmd: ["toggle"],
	desc: "Toggle optional features per group",
	usage: "toggle <feature> on|off|status",
	originalType: "owner",
	handler,
});
