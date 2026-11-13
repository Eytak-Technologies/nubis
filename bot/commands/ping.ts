import { command } from "nubis";

export default command({
	description: "Check that the bot is alive",
	run: ({ reply }) => reply("Pong!"),
});
