import axios from "axios";

const handler = async (sock, msg, from, args, msgInfoObj) => {
	const { sendMessageWTyping } = msgInfoObj;
	if (!args[0] || args[0].includes("http"))
		return sendMessageWTyping(from, { text: `*Provide Username*` }, { quoted: msg });
	let prof = args[0];

	let config = {
		method: "get",
		url: `https://apidirect.io/v1/instagram/user?username=${prof}`,
		headers: {
			"X-API-Key": process.env.APIDIRECT_KEY,
		},
	};

	axios
		.request(config)
		.then((res) => {
			if (res.data && res.data.user && res.data.user.profile_pic_url_hd) {
				sendMessageWTyping(
					from,
					{
						image: { url: res.data.user.profile_pic_url_hd },
						caption: `*Here is the Profile Picture of ${prof}*`,
					},
					{ quoted: msg }
				);
			} else {
				sendMessageWTyping(from, { text: `*No Data Found*` }, { quoted: msg });
			}
		})
		.catch(async (err) => {
			sendMessageWTyping(from, { text: "*Error fetching profile picture*" }, { quoted: msg });
		});
};

export default () => ({
	cmd: ["idp", "dp"],
	desc: "Get Instagram Profile Picture",
	usage: "idp | dp <username>",
	handler,
});
