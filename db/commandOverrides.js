import mdClient from "./client.js";

const overridesCollection = mdClient.db("MyBotDataDB").collection("CommandOverrides");

// Ensure unique index exists
overridesCollection.createIndex(
	{ commandKey: 1 },
	{ unique: true, name: "commandKey_unique" }
).catch(err => console.error("Error creating commandKey_unique index:", err));

const getCommandOverrides = async () => {
	try {
		const res = await overridesCollection.find({}).toArray();
		return res;
	} catch (err) {
		console.error("Error fetching command overrides:", err);
		return [];
	}
};

const setCommandOverride = async (commandKey, effectiveType, aliases) => {
	try {
		await overridesCollection.updateOne(
			{ commandKey },
			{
				$set: {
					commandKey,
					effectiveType,
					aliases,
				}
			},
			{ upsert: true }
		);
	} catch (err) {
		console.error("Error setting command override:", err);
		throw err;
	}
};

const deleteCommandOverride = async (commandKey) => {
	try {
		await overridesCollection.deleteOne({ commandKey });
	} catch (err) {
		console.error("Error deleting command override:", err);
		throw err;
	}
};

export { getCommandOverrides, setCommandOverride, deleteCommandOverride };
