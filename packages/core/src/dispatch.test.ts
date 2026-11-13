import { describe, expect, test } from "bun:test";
import { ApplicationCommandOptionType as Opt } from "discord-api-types/v10";
import { chatInput, recorder } from "./__fixtures__/interactions";
import {
	buildCommandTree,
	command,
	dispatch,
	NubisError,
	option,
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
		const { replies, responder } = recorder();

		const result = await dispatch(
			tree,
			chatInput("ban", [{ type: Opt.User, name: "user", value: "42" }], {
				users: {
					"42": { id: "42", username: "alice", discriminator: "0" } as never,
				},
			}),
			responder,
		);

		expect(result).toEqual({ status: "handled", path: ["ban"] });
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
		const { responder } = recorder();
		const value = [{ type: Opt.String, name: "value", value: "x" }] as const;

		await dispatch(
			tree,
			chatInput("config", [
				{ type: Opt.Subcommand, name: "set", options: [...value] },
			]),
			responder,
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
			responder,
		);

		expect(seen).toEqual(["set=x", "add=x"]);
		expect(result).toEqual({
			status: "handled",
			path: ["config", "role", "add"],
		});
	});

	test("reports unknown commands instead of throwing", async () => {
		const { responder } = recorder();
		expect(
			await dispatch(buildCommandTree([]), chatInput("gone"), responder),
		).toEqual({
			status: "unknown",
			path: ["gone"],
		});
	});

	test("explains a missing required option", async () => {
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
		const { responder } = recorder();
		const run = dispatch(tree, chatInput("echo"), responder);
		await expect(run).rejects.toThrow(NubisError);
		await expect(run).rejects.toThrow(/out of sync/);
	});
});
