import { describe, expect, test } from "bun:test";
import {
	ApplicationCommandOptionType as Opt,
	ApplicationCommandType,
} from "discord-api-types/v10";
import {
	buildCommandTree,
	command,
	type OptionDefinition,
	option,
	toCommandPayloads,
} from "./index";

describe("toCommandPayloads", () => {
	test("serializes a command, putting required options first", () => {
		const [payload] = toCommandPayloads(
			buildCommandTree([
				{
					path: ["ban"],
					definition: command({
						description: "Ban a member",
						options: {
							reason: option.string({ description: "Why" }),
							user: option.user({ required: true, description: "Who" }),
							days: option.integer(),
						},
						run: () => {},
					}),
				},
			]),
		);

		expect(payload).toEqual({
			type: ApplicationCommandType.ChatInput,
			name: "ban",
			description: "Ban a member",
			options: [
				{ type: Opt.User, name: "user", description: "Who", required: true },
				{
					type: Opt.String,
					name: "reason",
					description: "Why",
					required: false,
				},
				{
					type: Opt.Integer,
					name: "days",
					description: "days",
					required: false,
				},
			],
		});
	});

	test("folders become subcommands and subcommand groups", () => {
		const leaf = command({ description: "Leaf", run: () => {} });
		const [config] = toCommandPayloads(
			buildCommandTree([
				{ path: ["config", "show"], definition: leaf },
				{ path: ["config", "role", "add"], definition: leaf },
			]),
		);

		expect(config?.options).toEqual([
			{ type: Opt.Subcommand, name: "show", description: "Leaf", options: [] },
			{
				type: Opt.SubcommandGroup,
				name: "role",
				description: "role",
				options: [
					{
						type: Opt.Subcommand,
						name: "add",
						description: "Leaf",
						options: [],
					},
				],
			},
		]);
	});

	test("enforces Discord's limits with the command in the message", () => {
		const tooLong = command({ description: "x".repeat(101), run: () => {} });
		expect(() =>
			toCommandPayloads(
				buildCommandTree([{ path: ["ping"], definition: tooLong }]),
			),
		).toThrow(/\/ping: descriptions must be 1-100 characters/);

		const options: Record<string, OptionDefinition> = {};
		for (let i = 0; i < 26; i++) options[`o${i}`] = option.string();
		const crowded = command({ description: "Crowded", options, run: () => {} });
		expect(() =>
			toCommandPayloads(
				buildCommandTree([{ path: ["big"], definition: crowded }]),
			),
		).toThrow(/at most 25 options/);
	});
});
