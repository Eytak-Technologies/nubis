import { command } from "../../../../packages/nubis/dist/index.js";

export default command({
	description: "Replies with pong",
	run: ({ reply }) => reply("pong"),
});
