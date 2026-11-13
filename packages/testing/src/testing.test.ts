import { describe, expect, test } from "bun:test";
import {
	button,
	command,
	hasPermission,
	invokerOnly,
	messageCommand,
	modal,
	option,
	roleSelect,
	stateOf,
	textInput,
	userCommand,
} from "@nubisjs/core";
import { PermissionFlagsBits } from "discord-api-types/v10";
import { z } from "zod";
import {
	fake,
	fakeApi,
	testCommand,
	testComponent,
	testMenu,
	testModal,
} from "./index";

const ban = command({
	description: "Ban a member",
	ephemeral: true,
	options: {
		user: option.user({ required: true }),
		reason: option.string(),
		days: option.integer({
			choices: [
				{ name: "One", value: 1 },
				{ name: "Seven", value: 7 },
			],
		}),
	},
	guards: [hasPermission(PermissionFlagsBits.BanMembers)],
	run: ({ options, reply }) =>
		reply(
			`Banned ${options.user.username} for ${options.days ?? 0}d: ${options.reason ?? "no reason"}`,
		),
});

describe("testCommand", () => {
	test("runs with typed options and records the reply", async () => {
		const result = await testCommand(ban)
			.as({ permissions: PermissionFlagsBits.BanMembers })
			.run({ user: fake.user("alice"), days: 7, reason: "spam" });

		expect(result.status).toBe("handled");
		expect(result.replies).toEqual(["Banned alice for 7d: spam"]);
		expect(result.ephemeral).toBe(true);
	});

	test("the actor's language reaches the handler", async () => {
		const greet = command({
			description: "Greet",
			run: ({ interaction, reply }) =>
				reply(`${interaction.locale} ${interaction.guild_locale}`),
		});
		expect((await testCommand(greet).run()).replies).toEqual(["en-US en-US"]);
		expect(
			(await testCommand(greet).as({ locale: "tr", guildLocale: "de" }).run())
				.replies,
		).toEqual(["tr de"]);
	});

	test("guards see the actor: no permission, no ban", async () => {
		const result = await testCommand(ban).run({ user: fake.user("alice") });
		expect(result.status).toBe("denied");
		expect(result.replies).toEqual(["You don't have permission to do that."]);
	});

	test("checks options at compile time", async () => {
		const tester = testCommand(ban).as({
			permissions: PermissionFlagsBits.BanMembers,
		});
		// @ts-expect-error: the required option is missing
		await tester.run({ reason: "x" }).catch(() => {});
		// @ts-expect-error: 3 isn't one of the choices
		await tester.run({ user: fake.user(), days: 3 }).catch(() => {});
	});

	test("commands without options run with no arguments, in DMs too", async () => {
		const ping = command({
			description: "Ping",
			run: ({ reply }) => reply("pong"),
		});
		const result = await testCommand(ping).as({ dm: true }).run();
		expect(result.replies).toEqual(["pong"]);
	});

	test("errors come back on the result", async () => {
		const broken = command({
			description: "Broken",
			run: () => {
				throw new Error("database down");
			},
		});
		const result = await testCommand(broken).run();
		expect(result.status).toBe("error");
		expect(String(result.error)).toMatch(/database down/);
	});
});

describe("testComponent", () => {
	const confirm = button({
		id: "confirm",
		label: "Confirm",
		state: z.object({ userId: z.string() }),
		guards: [invokerOnly],
		onClick: ({ state, update }) => update(`Confirmed ${state.userId}`),
	});

	test("clicks a button with state, as the invoker or someone else", async () => {
		const alice = fake.user("alice");
		const ok = await testComponent(confirm)
			.as({ user: alice, invoker: alice })
			.click({ userId: "42" });
		expect(ok.replies).toEqual(["Confirmed 42"]);
		expect(ok.trace).toEqual(["respond:7"]);

		const other = await testComponent(confirm)
			.as({ user: fake.user("mallory"), invoker: alice })
			.click({ userId: "42" });
		expect(other.status).toBe("denied");
	});

	test("sends raw custom_ids to test tampering", async () => {
		const result = await testComponent(confirm).send('confirm~{"userId":7}');
		expect(result.status).toBe("stale");
	});

	test("picks fake roles from entity selects", async () => {
		const pick = roleSelect({
			id: "pick",
			state: stateOf<{ for: string }>(),
			onSelect: ({ roles, state, reply }) =>
				reply(`${state.for}: ${roles.map((r) => r.name).join(", ")}`),
		});
		const result = await testComponent(pick).select(
			[fake.role("Builder"), fake.role("Redstoner")],
			{
				for: "alice",
			},
		);
		expect(result.replies).toEqual(["alice: Builder, Redstoner"]);
	});
});

describe("testModal", () => {
	test("submits values with the state the modal was opened with", async () => {
		const report = modal({
			id: "report",
			title: "Report",
			fields: {
				player: textInput({ label: "Player", required: true }),
				details: textInput({ label: "Details" }),
			},
			state: stateOf<{ serverId: string }>(),
			onSubmit: ({ values, state, reply }) =>
				reply(
					`${state.serverId}: ${values.player} (${values.details ?? "no details"})`,
				),
		});
		const result = await testModal(report).submit(
			{ player: "Steve", details: "" },
			{ serverId: "s1" },
		);
		expect(result.replies).toEqual(["s1: Steve (no details)"]);
	});
});

describe("testMenu", () => {
	test("right-clicks fake users and messages", async () => {
		const profile = userCommand({
			name: "Profile",
			run: ({ target, reply }) => reply(target.username),
		});
		const quote = messageCommand({
			name: "Quote",
			run: ({ target, reply }) => reply(`> ${target.content}`),
		});

		expect((await testMenu(profile).run(fake.user("alice"))).replies).toEqual([
			"alice",
		]);
		expect((await testMenu(quote).run(fake.message("hello"))).replies).toEqual([
			"> hello",
		]);
	});
});

describe("fake", () => {
	test("ids are unique and snowflake-shaped", () => {
		const a = fake.user();
		const b = fake.user();
		expect(a.id).not.toBe(b.id);
		expect(a.id).toMatch(/^\d{17,20}$/);
	});
});

// This package doesn't import nubis, so NubisApi has no members here; bots that
// import nubis/testing see the full typed API.
type LooseApi = {
	guilds: Record<
		"get" | "removeMember",
		(...args: unknown[]) => Promise<unknown>
	>;
};

describe("fakeApi", () => {
	test("records what handlers ask Discord to do", async () => {
		const kick = command({
			description: "Kick",
			options: { user: option.user({ required: true }) },
			run: async ({ options, api, interaction, reply }) => {
				await (api as unknown as LooseApi).guilds.removeMember(
					interaction.guild_id ?? "",
					options.user.id,
				);
				await reply(`Kicked ${options.user.username}`);
			},
		});
		const api = fakeApi();
		const alice = fake.user("alice");
		const result = await testCommand(kick).with({ api }).run({ user: alice });

		expect(result.replies).toEqual(["Kicked alice"]);
		expect(api.callsTo("guilds.removeMember")).toEqual([
			{ method: "guilds.removeMember", args: ["test-guild", alice.id] },
		]);
	});

	test("answers with canned responses", async () => {
		const info = command({
			description: "Info",
			run: async ({ api, reply }) => {
				const guild = (await (api as unknown as LooseApi).guilds.get("g1")) as {
					name: string;
				};
				await reply(guild.name);
			},
		});
		const api = fakeApi({ "guilds.get": { id: "g1", name: "Nubis Test" } });
		expect((await testCommand(info).with({ api }).run()).replies).toEqual([
			"Nubis Test",
		]);
	});

	test("without one, using api explains how to get it", async () => {
		const info = command({
			description: "Info",
			run: async ({ api }) => {
				await (api as unknown as LooseApi).guilds.get("g1");
			},
		});
		const result = await testCommand(info).run();
		expect(result.status).toBe("error");
		expect(String(result.error)).toMatch(/no Discord API client/);
	});
});
