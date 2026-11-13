import { describe, expect, test } from "bun:test";
import { ComponentType, PermissionFlagsBits } from "discord-api-types/v10";
import {
	chatInput,
	componentInteraction,
	modalSubmit,
	recorder,
} from "./__fixtures__/interactions";
import {
	botHasPermission,
	buildCommandTree,
	button,
	type CommandFile,
	command,
	cooldown,
	createComponentRegistry,
	dispatch,
	dispatchComponent,
	dispatchModal,
	guard,
	guildOnly,
	hasPermission,
	hasRole,
	invokerOnly,
	middleware,
	modal,
	textInput,
	toCommandPayloads,
} from "./index";

const quiet = { autoDeferMs: false } as const;
const GUILD = { guildId: "g1" };

describe("guards on commands", () => {
	test("a denial answers privately and the command never runs", async () => {
		let ran = false;
		const tree = buildCommandTree([
			{
				path: ["ban"],
				definition: command({
					description: "Ban",
					guards: [guard(({ deny }) => deny("Not today."))],
					run: () => {
						ran = true;
					},
				}),
			},
		]);
		const { calls, transport } = recorder();
		const result = await dispatch(tree, chatInput("ban"), transport, quiet);

		expect(result).toEqual({
			status: "denied",
			path: ["ban"],
			message: "Not today.",
		});
		expect(ran).toBe(false);
		expect(calls[0]).toMatchObject({
			response: { data: { content: "Not today.", flags: 64 } },
		});
	});

	test("run in order: the bot's, then each folder's, then the command's", async () => {
		const order: string[] = [];
		const mark = (name: string) =>
			guard(() => {
				order.push(name);
			});
		const tree = buildCommandTree(
			[
				{
					path: ["admin", "users", "kick"],
					definition: command({
						description: "Kick",
						guards: [mark("command")],
						run: () => {},
					}),
				},
			],
			[
				{ path: ["admin"], guards: [mark("admin/")] },
				{ path: ["admin", "users"], guards: [mark("admin/users/")] },
			],
		);
		const { transport } = recorder();
		await dispatch(
			tree,
			chatInput("admin", [
				{
					type: 2,
					name: "users",
					options: [{ type: 1, name: "kick", options: [] }],
				},
			] as never),
			transport,
			{ ...quiet, guards: [mark("bot")] },
		);
		expect(order).toEqual(["bot", "admin/", "admin/users/", "command"]);
	});
});

describe("built-in guards", () => {
	const run = async (
		guards: Parameters<typeof command>[0]["guards"],
		actor?: Parameters<typeof chatInput>[3],
	) => {
		const tree = buildCommandTree([
			{
				path: ["x"],
				definition: command({
					description: "X",
					guards,
					run: ({ reply }) => reply("ok"),
				}),
			},
		]);
		const { replies, transport } = recorder();
		const result = await dispatch(
			tree,
			chatInput("x", undefined, undefined, actor),
			transport,
			quiet,
		);
		return { status: result.status, reply: replies[0] };
	};

	test("guildOnly", async () => {
		expect((await run([guildOnly])).reply).toMatch(/only works in a server/);
		expect((await run([guildOnly], GUILD)).status).toBe("handled");
	});

	test("hasPermission checks the member's permission bits", async () => {
		const banners = [hasPermission(PermissionFlagsBits.BanMembers)];
		expect(
			(
				await run(banners, {
					...GUILD,
					permissions: PermissionFlagsBits.SendMessages,
				})
			).status,
		).toBe("denied");
		expect(
			(
				await run(banners, {
					...GUILD,
					permissions:
						PermissionFlagsBits.BanMembers | PermissionFlagsBits.SendMessages,
				})
			).status,
		).toBe("handled");
		expect((await run(banners)).status).toBe("denied"); // DMs have no member
	});

	test("botHasPermission checks the bot's own permissions", async () => {
		const needs = [botHasPermission(PermissionFlagsBits.ManageRoles)];
		expect((await run(needs, { appPermissions: 0n })).reply).toMatch(
			/I don't have the permissions/,
		);
		expect(
			(await run(needs, { appPermissions: PermissionFlagsBits.ManageRoles }))
				.status,
		).toBe("handled");
	});

	test("hasRole takes ids or functions that read them", async () => {
		let staffRole: string | undefined = "staff";
		const staffOnly = [hasRole(() => staffRole)];
		expect((await run(staffOnly, { ...GUILD, roles: ["member"] })).status).toBe(
			"denied",
		);
		expect(
			(await run(staffOnly, { ...GUILD, roles: ["member", "staff"] })).status,
		).toBe("handled");
		staffRole = undefined;
		expect((await run(staffOnly, { ...GUILD, roles: ["staff"] })).status).toBe(
			"denied",
		);
	});

	test("cooldown allows one use per window, per user by default", async () => {
		let now = 1_000_000;
		const limited = [cooldown({ seconds: 10, now: () => now })];
		const tree = buildCommandTree([
			{
				path: ["x"],
				definition: command({
					description: "X",
					guards: limited,
					run: ({ reply }) => reply("ok"),
				}),
			},
		]);
		const use = async (userId: string) => {
			const { replies, transport } = recorder();
			await dispatch(
				tree,
				chatInput("x", undefined, undefined, { userId }),
				transport,
				quiet,
			);
			return replies[0];
		};

		expect(await use("alice")).toBe("ok");
		expect(await use("alice")).toBe(
			`Slow down! You can do that again <t:${1_000_000 / 1000 + 10}:R>.`,
		);
		expect(await use("bob")).toBe("ok");
		now += 10_000;
		expect(await use("alice")).toBe("ok");
	});
});

describe("middleware", () => {
	test("wraps handlers, outermost first, and sees errors", async () => {
		const events: string[] = [];
		const wrap = (name: string) =>
			middleware(async ({ name: command }, next) => {
				events.push(`${name}:before ${command}`);
				try {
					await next();
					events.push(`${name}:after`);
				} catch (error) {
					events.push(`${name}:caught ${(error as Error).message}`);
					throw error;
				}
			});
		const files: CommandFile[] = [
			{
				path: ["ok"],
				definition: command({
					description: "OK",
					middleware: [wrap("command")],
					run: () => {
						events.push("run");
					},
				}),
			},
			{
				path: ["fail"],
				definition: command({
					description: "Fail",
					run: () => {
						throw new Error("boom");
					},
				}),
			},
		];
		const tree = buildCommandTree(files);
		const { transport } = recorder();

		await dispatch(tree, chatInput("ok"), transport, {
			...quiet,
			middleware: [wrap("bot")],
		});
		const failed = await dispatch(tree, chatInput("fail"), transport, {
			...quiet,
			middleware: [wrap("bot")],
		});

		expect(events).toEqual([
			"bot:before /ok",
			"command:before /ok",
			"run",
			"command:after",
			"bot:after",
			"bot:before /fail",
			"bot:caught boom",
		]);
		expect(failed.status).toBe("error");
	});

	test("calling next() twice is an error", async () => {
		const twice = middleware(async (_, next) => {
			await next();
			await next();
		});
		const tree = buildCommandTree([
			{ path: ["x"], definition: command({ description: "X", run: () => {} }) },
		]);
		const { transport } = recorder();
		const result = await dispatch(tree, chatInput("x"), transport, {
			...quiet,
			middleware: [twice],
		});
		expect(result.status).toBe("error");
	});
});

describe("guards on components and modals", () => {
	test("invokerOnly keeps other people's hands off a button", async () => {
		const clicks: string[] = [];
		const confirm = button({
			id: "confirm",
			label: "Confirm",
			guards: [invokerOnly],
			onClick: ({ interaction }) => {
				clicks.push(interaction.member?.user.id ?? interaction.user?.id ?? "?");
			},
		});
		const registry = createComponentRegistry([confirm]);
		const click = (userId: string) =>
			componentInteraction(
				"confirm",
				{ type: ComponentType.Button },
				{ userId, invokerId: "alice" },
			);

		const { replies, transport } = recorder();
		expect(
			(await dispatchComponent(registry, click("mallory"), transport, quiet))
				.status,
		).toBe("denied");
		expect(replies).toEqual([
			"Only the person who used the command can do that.",
		]);
		expect(
			(await dispatchComponent(registry, click("alice"), transport, quiet))
				.status,
		).toBe("handled");
		expect(clicks).toEqual(["alice"]);
	});

	test("bot-wide guards apply to components and modals too", async () => {
		const form = modal({
			id: "form",
			title: "Form",
			fields: { a: textInput({ label: "A" }) },
			onSubmit: () => {},
		});
		const ok = button({ id: "ok", label: "OK", onClick: () => {} });
		const registry = createComponentRegistry([form, ok]);
		const options = { ...quiet, guards: [guildOnly] };
		const { transport } = recorder();

		expect(
			(
				await dispatchComponent(
					registry,
					componentInteraction("ok", { type: ComponentType.Button }),
					transport,
					options,
				)
			).status,
		).toBe("denied");
		expect(
			(
				await dispatchModal(
					registry,
					modalSubmit("form", { a: "x" }),
					transport,
					options,
				)
			).status,
		).toBe("denied");
		expect(
			(
				await dispatchModal(
					registry,
					modalSubmit("form", { a: "x" }, GUILD),
					transport,
					options,
				)
			).status,
		).toBe("handled");
	});
});

describe("folder settings and Discord permissions", () => {
	const leaf = command({ description: "Leaf", run: () => {} });

	test("folders get descriptions and top-level permissions", () => {
		const [admin] = toCommandPayloads(
			buildCommandTree(
				[{ path: ["admin", "users", "kick"], definition: leaf }],
				[
					{
						path: ["admin"],
						description: "Server admin tools",
						defaultMemberPermissions: [
							PermissionFlagsBits.KickMembers,
							PermissionFlagsBits.BanMembers,
						],
					},
					{ path: ["admin", "users"], description: "Manage members" },
				],
			),
		);
		expect(admin).toMatchObject({
			description: "Server admin tools",
			default_member_permissions: String(
				PermissionFlagsBits.KickMembers | PermissionFlagsBits.BanMembers,
			),
			options: [{ name: "users", description: "Manage members" }],
		});
	});

	test("top-level commands take defaultMemberPermissions, nested ones can't", () => {
		const banned = command({
			description: "Ban",
			defaultMemberPermissions: [PermissionFlagsBits.BanMembers],
			run: () => {},
		});
		expect(
			toCommandPayloads(
				buildCommandTree([{ path: ["ban"], definition: banned }]),
			)[0],
		).toMatchObject({
			default_member_permissions: String(PermissionFlagsBits.BanMembers),
		});
		expect(() =>
			toCommandPayloads(
				buildCommandTree([{ path: ["mod", "ban"], definition: banned }]),
			),
		).toThrow(/Set it on the commands\/mod folder instead/);
	});

	test("folder settings need a folder", () => {
		expect(() =>
			buildCommandTree(
				[{ path: ["ping"], definition: leaf }],
				[{ path: ["admin"] }],
			),
		).toThrow(/there is none/);
		expect(() =>
			buildCommandTree(
				[{ path: ["ping"], definition: leaf }],
				[{ path: ["ping"] }],
			),
		).toThrow(/there is none/);
	});
});
