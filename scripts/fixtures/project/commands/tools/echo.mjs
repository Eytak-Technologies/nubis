import { command, option } from "../../../../../packages/nubis/dist/index.js";

export default command({
	description: "Echoes text",
	options: { text: option.string({ required: true }) },
	run: ({ options, reply }) => reply(options.text),
});
