import { command } from "@nubisjs/core";

export default command({
	description: "Replies with pong",
	run: ({ reply }) => reply("pong"),
});
