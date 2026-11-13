import { command, option } from "nubis";

export default command({
	description: "Roll a die",
	options: {
		sides: option.integer({
			description: "How many sides",
			choices: [
				{ name: "Six", value: 6 },
				{ name: "Twenty", value: 20 },
			],
		}),
	},
	// options.sides is 6 | 20 | undefined, from the choices.
	run: ({ options, reply }) => {
		const sides = options.sides ?? 6;
		return reply(
			`🎲 You rolled ${1 + Math.floor(Math.random() * sides)} (d${sides})`,
		);
	},
});
