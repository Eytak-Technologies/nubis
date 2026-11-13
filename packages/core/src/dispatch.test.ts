import { describe, expect, test } from "bun:test";
import {
	ComponentType,
	InteractionResponseType,
	ApplicationCommandOptionType as Opt,
} from "discord-api-types/v10";
import { chatInput, recorder } from "./__fixtures__/interactions";
import {
	buildCommandTree,
	button,
	command,
	DEFAULT_ALLOWED_MENTIONS,
	dispatch,
	ERROR_MESSAGE,
	NubisError,
	option,
	stateOf,
} from "./index";

describe("dispatch", () => {
	test("runs a top-level command and resolves its options", async () => {
		const tree = buildCommandTree([
			{
				path: ["ban"],
				definition: command({
					description: "Ban",
					options: {
						user: option.user({ required: true }),
						reason: option.string(),
					},
					run: ({ options, reply }) =>
						reply(`${options.user.username}: ${options.reason ?? "no reason"}`),
				}),
			},
		]);
		const { replies, transport } = recorder();

		const result = await dispatch(
			tree,
			chatInput("ban", [{ type: Opt.User, name: "user", value: "42" }], {
				users: {
					"42": { id: "42", username: "alice", discriminator: "0" } as never,
				},
			}),
			transport,
		);

		expect(result).toEqual({
			status: "handled",
			path: ["ban"],
			responded: true,
		});
		expect(replies).toEqual(["alice: no reason"]);
	});

	test("routes subcommands and groups", async () => {
		const seen: string[] = [];
		const leaf = (name: string) =>
			command({
				description: name,
				options: { value: option.string({ required: true }) },
				run: ({ options }) => {
					seen.push(`${name}=${options.value}`);
				},
			});
		const tree = buildCommandTree([
			{ path: ["config", "set"], definition: leaf("set") },
			{ path: ["config", "role", "add"], definition: leaf("add") },
		]);
		const { transport } = recorder();
		const value = [{ type: Opt.String, name: "value", value: "x" }] as const;

		await dispatch(
			tree,
			chatInput("config", [
				{ type: Opt.Subcommand, name: "set", options: [...value] },
			]),
			transport,
		);
		const result = await dispatch(
			tree,
			chatInput("config", [
				{
					type: Opt.SubcommandGroup,
					name: "role",
					options: [{ type: Opt.Subcommand, name: "add", options: [...value] }],
				},
			]),
			transport,
		);

		expect(seen).toEqual(["set=x", "add=x"]);
		expect(result).toEqual({
			status: "handled",
			path: ["config", "role", "add"],
			responded: false,
		});
	});

	test("reports unknown commands instead of throwing", async () => {
		const { transport } = recorder();
		expect(
			await dispatch(buildCommandTree([]), chatInput("gone"), transport),
		).toEqual({
			status: "unknown",
			path: ["gone"],
		});
	});

	test("explains a missing required option and tells the user", async () => {
		const tree = buildCommandTree([
			{
				path: ["echo"],
				definition: command({
					description: "Echo",
					options: { text: option.string({ required: true }) },
					run: () => {},
				}),
			},
		]);
		const { replies, transport } = recorder();
		const result = await dispatch(tree, chatInput("echo"), transport);

		expect(result.status).toBe("error");
		if (result.status !== "error") return;
		expect(result.error).toBeInstanceOf(NubisError);
		expect(String(result.error)).toMatch(/out of sync/);
		expect(replies).toEqual([ERROR_MESSAGE]);
	});

	test("replies can carry components, packed into rows", async () => {
		const confirm = button({
			id: "confirm",
			label: "Confirm",
			state: stateOf<{ id: string }>(),
			onClick: () => {},
		});
		const tree = buildCommandTree([
			{
				path: ["ask"],
				definition: command({
					description: "Ask",
					run: ({ reply }) =>
						reply({
							content: "Sure?",
							components: [confirm({ id: "42" })],
							ephemeral: true,
						}),
				}),
			},
		]);
		const { calls, transport } = recorder();
		await dispatch(tree, chatInput("ask"), transport);

		expect(calls).toEqual([
			{
				type: "respond",
				response: {
					type: InteractionResponseType.ChannelMessageWithSource,
					data: {
						content: "Sure?",
						components: [
							{
								type: ComponentType.ActionRow,
								components: [confirm({ id: "42" })],
							},
						],
						allowed_mentions: DEFAULT_ALLOWED_MENTIONS,
						flags: 64,
					},
				},
			},
		]);
	});
});
