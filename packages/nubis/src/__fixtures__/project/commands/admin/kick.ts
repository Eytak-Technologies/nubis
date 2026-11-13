import { command, option } from "@nubisjs/core";
import { reason } from "../_shared";

export default command({
	description: "Kick a member",
	options: { user: option.user({ required: true }), reason },
	run: ({ options, reply }) => reply(`Kicked ${options.user.username}`),
});
