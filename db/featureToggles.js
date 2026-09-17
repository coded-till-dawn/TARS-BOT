import mdClient from "./client.js";

const featureToggles = mdClient.db("MyBotDataDB").collection("FeatureToggles");

/**
 * Get the current state of a feature in a group.
 * Defaults to true if no override is found.
 */
const getFeatureState = async (groupId, feature) => {
	try {
		const res = await featureToggles.findOne({ groupId, feature });
		return res ? res.enabled : true;
	} catch (err) {
		console.error("[featureTogglesDB get error]", err.message);
		return true;
	}
};

/**
 * Set the state of a feature in a group.
 * We use an override-only model, so setting to true (default) deletes the record.
 */
const setFeatureState = async (groupId, feature, enabled) => {
	try {
		if (enabled) {
			await featureToggles.deleteOne({ groupId, feature });
		} else {
			await featureToggles.updateOne(
				{ groupId, feature },
				{ $set: { enabled: false } },
				{ upsert: true }
			);
		}
	} catch (err) {
		console.error("[featureTogglesDB set error]", err.message);
	}
};

/**
 * Get all explicitly overridden features for a group.
 */
const listGroupFeatures = async (groupId) => {
	try {
		return await featureToggles.find({ groupId }).toArray();
	} catch (err) {
		console.error("[featureTogglesDB list error]", err.message);
		return [];
	}
};

export { getFeatureState, setFeatureState, listGroupFeatures };
