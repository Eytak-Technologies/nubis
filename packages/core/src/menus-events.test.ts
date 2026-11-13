import { describe, expect, test } from "bun:test";
import {
	type APIContextMenuInteraction,
	ApplicationCommandType,
	type GatewayGuildMemberAddDispatchData,
	PermissionFlagsBits,
} from "discord-api-types/v10";
import { actorFields, recorder } from "./__fixtures__/interactions";
import {
	createEventRegistry,
	dispatchEvent,
	dispatchMenu,
	type EventName,
	event,
	guard,
	messageCommand,
	planSync,
	toEventName,
	toMenuPayloads,
	userCommand,
} from "./index";

type Equal<A, B> =
	(<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
		? true
		: false;
const assertType = <_T extends true>() => {};

const quiet = { autoDeferMs: false } as const;

const menuInteraction = (
	type: "user" | "message",
	name: string,
): APIContextMenuInteraction =>
	({
		...actorFields({ guildId: "g1" }),
		id: "1",
		application_id: "2",
		type: 2,
		token: "t",
		version: 1,
		data:
			type === "user"
				? {
						id: "3",
						type: ApplicationCommandType.User,
						name,
						target_id: "42",
						resolved: {
							users: {
								"42": { id: "42", username: "alice", discriminator: "0" },
							},
							members: { "42": { roles: ["r1"], joined_at: "2026-01-01" } },
						},
					}
				: {
						id: "3",
						type: ApplicationCommandType.Message,
						name,
						target_id: "m1",
						resolved: {
							messages: { m1: { id: "m1", content: "spam spam spam" } },
						},
					},
	}) as unknown as APIContextMenuInteraction;

describe("context menu commands", () => {
	const profile = userCommand({
		name: "View profile",
		ephemeral: true,
		run: ({ target, targetMember, reply }) =>
			reply(`${target.username} has ${targetMember?.roles.length ?? 0} roles`),
	});
	const report = messageCommand({
		name: "Report message",
		defaultMemberPermissions: [PermissionFlagsBits.SendMessages],
		contexts: ["guild"],
		run: ({ target, reply }) => reply(`Reported: ${target.content}`),
	});

	test("hand the right-clicked user or message to run()", async () => {
		const user = recorder();
		const result = await dispatchMenu(
			[profile, report],
			menuInteraction("user", "View profile"),
			user.transport,
			quiet,
		);
		expect(result).toEqual({
			status: "handled",
			name: "View profile",
			responded: true,
		});
		expect(user.replies).toEqual(["alice has 1 roles"]);
		expect(user.calls[0]).toMatchObject({ response: { data: { flags: 64 } } });

		const message = recorder();
		await dispatchMenu(
			[profile, report],
			menuInteraction("message", "Report message"),
			message.transport,
			quiet,
		);
		expect(message.replies).toEqual(["Reported: spam spam spam"]);
	});

	test("match by type as well as name", async () => {
		const { transport } = recorder();
		const result = await dispatchMenu(
			[profile],
			menuInteraction("message", "View profile"),
			transport,
			quiet,
		);
		expect(result.status).toBe("unknown");
	});

	test("run guards", async () => {
		const locked = userCommand({
			name: "Locked",
			guards: [guard(({ deny }) => deny("Nope."))],
			run: () => {},
		});
		const { replies, transport } = recorder();
		const result = await dispatchMenu(
			[locked],
			menuInteraction("user", "Locked"),
			transport,
			quiet,
		);
		expect(result.status).toBe("denied");
		expect(replies).toEqual(["Nope."]);
	});

	test("serialize with top-level settings and no description", () => {
		expect(toMenuPayloads([profile, report])).toEqual([
			{ type: ApplicationCommandType.User, name: "View profile" },
			{
				type: ApplicationCommandType.Message,
				name: "Report message",
				default_member_permissions: String(PermissionFlagsBits.SendMessages),
				contexts: [0],
			},
		]);
	});

	test("check names, duplicates and Discord's limit of 15 per type", () => {
		expect(() => userCommand({ name: "x".repeat(33), run: () => {} })).toThrow(
			/1-32 characters/,
		);
		expect(() => userCommand({ name: "   ", run: () => {} })).toThrow(
			/not blank/,
		);
		expect(() => toMenuPayloads([profile, profile])).toThrow(
			/Two user context menu commands are named "View profile"/,
		);
		const many = Array.from({ length: 16 }, (_, i) =>
			messageCommand({ name: `Menu ${i}`, run: () => {} }),
		);
		expect(() => toMenuPayloads(many)).toThrow(/at most 15 message/);
	});

	test("sync alongside slash commands", () => {
		const plan = planSync(toMenuPayloads([profile]), []);
		expect(plan.create).toEqual([
			{ type: ApplicationCommandType.User, name: "View profile" },
		]);
	});
});

describe("events", () => {
	test("names convert from Discord's, in types and at runtime", () => {
		assertType<Equal<Extract<EventName, "guildMemberAdd">, "guildMemberAdd">>();
		assertType<
			Equal<
				Extract<EventName, "messageReactionRemoveAll">,
				"messageReactionRemoveAll"
			>
		>();
		expect(toEventName("GUILD_MEMBER_ADD")).toBe("guildMemberAdd");
		expect(toEventName("MESSAGE_REACTION_REMOVE_ALL")).toBe(
			"messageReactionRemoveAll",
		);
		expect(toEventName("READY")).toBe("ready");
	});

	test("handlers get Discord's payload, typed", async () => {
		const welcomed: string[] = [];
		const welcome = event("guildMemberAdd", (member, context) => {
			assertType<Equal<typeof member, GatewayGuildMemberAddDispatchData>>();
			welcomed.push(
				`${member.user.username}@${member.guild_id} via ${context.name}`,
			);
		});
		const registry = createEventRegistry([welcome]);

		const result = await dispatchEvent(registry, "GUILD_MEMBER_ADD", {
			guild_id: "g1",
			user: { id: "1", username: "alice" },
			roles: [],
		});
		expect(result).toEqual({ name: "guildMemberAdd", handled: 1, errors: [] });
		expect(welcomed).toEqual(["alice@g1 via guildMemberAdd"]);
	});

	test("several handlers per event; one failing doesn't stop the rest", async () => {
		const ran: string[] = [];
		const registry = createEventRegistry([
			event("messageCreate", () => {
				ran.push("log");
			}),
			event("messageCreate", () => {
				throw new Error("filter down");
			}),
			event("messageCreate", async () => {
				ran.push("stats");
			}),
		]);
		const result = await dispatchEvent(
			registry,
			"MESSAGE_CREATE",
			{ id: "m1" },
			{ shardId: 2 },
		);

		expect(ran.sort()).toEqual(["log", "stats"]);
		expect(result.handled).toBe(2);
		expect(String(result.errors[0])).toMatch(/filter down/);
	});

	test("events nobody listens to are fine", async () => {
		expect(
			await dispatchEvent(createEventRegistry([]), "TYPING_START", {}),
		).toEqual({
			name: "typingStart",
			handled: 0,
			errors: [],
		});
	});
});
