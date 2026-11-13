import { describe, expect, test } from "bun:test";
import {
	type APIApplicationCommand,
	ChannelType,
	ApplicationCommandOptionType as Opt,
	PermissionFlagsBits,
} from "discord-api-types/v10";
import { autocomplete, chatInput, recorder } from "./__fixtures__/interactions";
import {
	buildCommandTree,
	type CommandDefinition,
	command,
	dispatch,
	dispatchAutocomplete,
	guard,
	type OptionMap,
	option,
	planSync,
	toCommandPayloads,
} from "./index";

type Equal<A, B> =
	(<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
		? true
		: false;
const assertType = <_T extends true>() => {};

const payloadOf = (definition: CommandDefinition<OptionMap>, path = ["x"]) =>
	toCommandPayloads(buildCommandTree([{ path, definition }]))[0];

describe("choices", () => {
	test("type the value as the union of choice values", async () => {
		const seen: unknown[] = [];
		const color = command({
			description: "Pick a color",
			options: {
				color: option.string({
					required: true,
					choices: [
						{ name: "Red", value: "red" },
						{ name: "Blue", value: "blue" },
					],
				}),
				size: option.integer({
					choices: [
						{ name: "Small", value: 1 },
						{ name: "Large", value: 3 },
					],
				}),
				free: option.string(),
			},
			run: ({ options }) => {
				assertType<Equal<typeof options.color, "red" | "blue">>();
				assertType<Equal<typeof options.size, 1 | 3 | undefined>>();
				assertType<Equal<typeof options.free, string | undefined>>();
				seen.push(options.color, options.size);
			},
		});

		const { transport } = recorder();
		await dispatch(
			buildCommandTree([{ path: ["color"], definition: color }]),
			chatInput("color", [
				{ type: Opt.String, name: "color", value: "blue" },
				{ type: Opt.Integer, name: "size", value: 3 },
			]),
			transport,
			{ autoDeferMs: false },
		);
		expect(seen).toEqual(["blue", 3]);
		expect(payloadOf(color)?.options?.[0]).toMatchObject({
			choices: [
				{ name: "Red", value: "red" },
				{ name: "Blue", value: "blue" },
			],
		});
	});
});

describe("option settings", () => {
	test("serialize lengths, ranges, channel types and autocomplete", () => {
		const payload = payloadOf(
			command({
				description: "Settings",
				options: {
					name: option.string({ minLength: 2, maxLength: 32 }),
					amount: option.number({ minValue: 0.5, maxValue: 10 }),
					where: option.channel({
						channelTypes: [
							ChannelType.GuildText,
							ChannelType.GuildAnnouncement,
						],
					}),
					search: option.string({ autocomplete: () => [] }),
				},
				run: () => {},
			}),
		);
		expect(payload?.options).toEqual([
			{
				type: Opt.String,
				name: "name",
				description: "name",
				required: false,
				min_length: 2,
				max_length: 32,
			},
			{
				type: Opt.Number,
				name: "amount",
				description: "amount",
				required: false,
				min_value: 0.5,
				max_value: 10,
			},
			{
				type: Opt.Channel,
				name: "where",
				description: "where",
				required: false,
				channel_types: [ChannelType.GuildText, ChannelType.GuildAnnouncement],
			},
			{
				type: Opt.String,
				name: "search",
				description: "search",
				required: false,
				autocomplete: true,
			},
		]);
	});

	test("check Discord's rules with the option in the message", () => {
		const bad = (options: OptionMap) => () =>
			payloadOf(command({ description: "Bad", options, run: () => {} }));

		expect(
			bad({
				a: option.string({
					choices: [{ name: "A", value: "a" }],
					autocomplete: () => [],
				}),
			}),
		).toThrow(/option "a": use choices or autocomplete, not both/);
		expect(
			bad({
				a: option.string({
					choices: Array.from({ length: 26 }, (_, i) => ({
						name: `${i}`,
						value: `${i}`,
					})),
				}),
			}),
		).toThrow(/needs 1-25 choices/);
		expect(
			bad({ a: option.integer({ choices: [{ name: "Half", value: 0.5 }] }) }),
		).toThrow(/whole numbers/);
		expect(bad({ a: option.integer({ minValue: 10, maxValue: 1 }) })).toThrow(
			/minValue is larger/,
		);
		expect(bad({ a: option.string({ minLength: 10, maxLength: 5 }) })).toThrow(
			/minLength is larger/,
		);
		expect(bad({ a: option.channel({ channelTypes: [] }) })).toThrow(
			/at least one type/,
		);
	});
});

describe("contexts, integration types and nsfw", () => {
	test("serialize on top-level commands and folders", () => {
		expect(
			payloadOf(
				command({
					description: "Everywhere",
					contexts: ["guild", "bot-dm", "private-channel"],
					integrationTypes: ["guild", "user"],
					nsfw: true,
					run: () => {},
				}),
			),
		).toMatchObject({
			contexts: [0, 1, 2],
			integration_types: [0, 1],
			nsfw: true,
		});

		const [folder] = toCommandPayloads(
			buildCommandTree(
				[
					{
						path: ["tools", "ping"],
						definition: command({ description: "Ping", run: () => {} }),
					},
				],
				[{ path: ["tools"], contexts: ["guild"] }],
			),
		);
		expect(folder).toMatchObject({ contexts: [0] });
	});

	test("are rejected on nested commands", () => {
		const nested = command({
			description: "Nested",
			nsfw: true,
			run: () => {},
		});
		expect(() => payloadOf(nested, ["tools", "nested"])).toThrow(
			/only work on top-level commands/,
		);
	});
});

describe("autocomplete", () => {
	const searched: unknown[] = [];
	const play = command({
		description: "Play a song",
		options: {
			genre: option.string({ choices: [{ name: "Rock", value: "rock" }] }),
			song: option.string({
				required: true,
				autocomplete: ({ value, options }) => {
					searched.push({ value, genre: options.genre });
					return Array.from({ length: 30 }, (_, i) => ({
						name: `${value} ${i}`,
						value: `${value}-${i}`,
					}));
				},
			}),
		},
		run: () => {},
	});
	const tree = buildCommandTree([
		{ path: ["music", "play"], definition: play },
		{
			path: ["broken"],
			definition: command({
				description: "Broken",
				options: {
					q: option.string({
						autocomplete: () => {
							throw new Error("search down");
						},
					}),
				},
				run: () => {},
			}),
		},
	]);
	const focusedSong = (value: string) =>
		autocomplete("music", [
			{
				type: Opt.Subcommand,
				name: "play",
				options: [
					{ type: Opt.String, name: "genre", value: "rock" },
					{ type: Opt.String, name: "song", value, focused: true },
				],
			},
		] as never);

	test("answers with the focused option's suggestions, at most 25", async () => {
		const { calls, transport } = recorder();
		const result = await dispatchAutocomplete(
			tree,
			focusedSong("tho"),
			transport,
		);

		expect(result).toEqual({
			status: "handled",
			path: ["music", "play"],
			count: 25,
		});
		expect(searched).toEqual([{ value: "tho", genre: "rock" }]);
		expect(calls[0]).toMatchObject({ type: "respond", response: { type: 8 } });
		const choices = (calls[0] as { response: { data: { choices: unknown[] } } })
			.response.data.choices;
		expect(choices).toHaveLength(25);
		expect(choices[0]).toEqual({ name: "tho 0", value: "tho-0" });
	});

	test("always answers, with nothing when it can't suggest", async () => {
		const empty = { type: 8, data: { choices: [] } };

		const broken = recorder();
		const failed = await dispatchAutocomplete(
			tree,
			autocomplete("broken", [
				{ type: Opt.String, name: "q", value: "x", focused: true },
			]),
			broken.transport,
		);
		expect(failed.status).toBe("error");
		expect(broken.calls[0]).toMatchObject({ response: empty });

		const gone = recorder();
		expect(
			(
				await dispatchAutocomplete(
					tree,
					autocomplete("gone", []),
					gone.transport,
				)
			).status,
		).toBe("unknown");
		expect(gone.calls[0]).toMatchObject({ response: empty });
	});

	test("guards hide suggestions from people who can't use the command", async () => {
		const { calls, transport } = recorder();
		const result = await dispatchAutocomplete(
			tree,
			focusedSong("x"),
			transport,
			{
				guards: [guard(({ deny }) => deny("no"))],
			},
		);
		expect(result.status).toBe("denied");
		expect(calls[0]).toMatchObject({
			response: { type: 8, data: { choices: [] } },
		});
	});
});

describe("planSync sees every field Nubis writes", () => {
	const ban = (permissions?: bigint[]) =>
		payloadOf(
			command({
				description: "Ban",
				defaultMemberPermissions: permissions,
				run: () => {},
			}),
			["ban"],
		)!;
	const asRemote = (
		payload: ReturnType<typeof ban>,
		extra: object = {},
	): APIApplicationCommand =>
		({
			id: "1",
			application_id: "a",
			version: "1",
			...payload,
			...extra,
		}) as APIApplicationCommand;

	test("a permission change is an update", () => {
		const plan = planSync(
			[ban([PermissionFlagsBits.BanMembers])],
			[asRemote(ban())],
		);
		expect(plan.update.map((u) => u.payload.name)).toEqual(["ban"]);
	});

	test("Discord's defaults don't count as changes", () => {
		const plan = planSync(
			[ban()],
			[
				asRemote(ban(), {
					integration_types: [0],
					contexts: null,
					nsfw: false,
					name_localizations: null,
				}),
			],
		);
		expect(plan.unchanged).toEqual(["ban"]);
	});

	test("a choice change is an update", () => {
		const withChoices = (value: string) =>
			payloadOf(
				command({
					description: "Pick",
					options: { c: option.string({ choices: [{ name: "C", value }] }) },
					run: () => {},
				}),
				["pick"],
			)!;
		expect(
			planSync([withChoices("b")], [asRemote(withChoices("a"))]).update,
		).toHaveLength(1);
		expect(
			planSync([withChoices("a")], [asRemote(withChoices("a"))]).unchanged,
		).toEqual(["pick"]);
	});
});
