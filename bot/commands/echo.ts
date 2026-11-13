import { command, option } from "nubis";

export default command({
	description: "Repeat something back to you",
	ephemeral: true,
	options: {
		text: option.string({
			description: "What to repeat",
			required: true,
			maxLength: 200,
		}),
	},
	// options.text is a string: required options are never undefined.
	run: ({ options, reply }) => reply(options.text),
});
