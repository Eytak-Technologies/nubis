import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	buildCommandTree,
	command,
	createComponentRegistry,
	createEventRegistry,
	event,
	userCommand,
} from "@nubisjs/core";
import {
	type GatewayDispatchPayload,
	GatewayIntentBits as I,
} from "discord-api-types/v10";
import type { Project } from "./loader";
import {
	createBot,
	discordEnv,
	type GatewayLike,
	intentNames,
	intentsFor,
	loadEnv,
	parseEnv,
	type RestLike,
	restTransport,
	syncCommands,
} from "./node";

/** A REST client that records calls and answers GETs with `remote`. */
function fakeRest(remote: unknown = []) {
	const calls: {
		method: string;
		route: string;
		options?: { body?: unknown; auth?: boolean; files?: unknown };
	}[] = [];
	const record =
		(method: string) => async (route: string, options?: object) => {
			calls.push({ method, route, options: options as never });
			return method === "get" ? remote : {};
		};
	const rest: RestLike = {
		get: record("get"),
		post: record("post"),
		put: record("put"),
		patch: record("patch"),
		delete: record("delete"),
	};
	return { rest, calls };
}

const project = (overrides: Partial<Project> = {}): Project => ({
	root: "/bot",
	files: [],
	tree: buildCommandTree([
		{
			path: ["ping"],
			definition: command({
				description: "Ping",
				run: ({ reply }) => reply("pong"),
			}),
		},
	]),
	components: createComponentRegistry([]),
	menus: [userCommand({ name: "Profile", run: () => {} })],
	events: createEventRegistry([]),
	...overrides,
});

describe(".env", () => {
	test("parses KEY=VALUE lines, quotes and comments", () => {
		expect(
			parseEnv('# token\nDISCORD_TOKEN="abc"\nexport ID=123\n\nEMPTY=\n'),
		).toEqual({
			DISCORD_TOKEN: "abc",
			ID: "123",
			EMPTY: "",
		});
	});

	test("finds the nearest .env up the tree without overriding what's set", async () => {
		const root = await mkdtemp(join(tmpdir(), "nubis-env-"));
		await writeFile(
			join(root, ".env"),
			"DISCORD_TOKEN=from-file\nDISCORD_APPLICATION_ID=1\n",
		);
		await mkdir(join(root, "bot", "deep"), { recursive: true });
		const env: Record<string, string | undefined> = {
			DISCORD_APPLICATION_ID: "already-set",
		};

		expect(await loadEnv(join(root, "bot", "deep"), env)).toBe(
			join(root, ".env"),
		);
		expect(env).toEqual({
			DISCORD_TOKEN: "from-file",
			DISCORD_APPLICATION_ID: "already-set",
		});
	});

	test("names missing settings", () => {
		expect(() => discordEnv({})).toThrow(
			/Missing DISCORD_TOKEN and DISCORD_APPLICATION_ID/,
		);
		expect(
			discordEnv({ DISCORD_TOKEN: "t", DISCORD_APPLICATION_ID: "a" }),
		).toEqual({
			token: "t",
			applicationId: "a",
			publicKey: undefined,
			devGuildId: undefined,
		});
	});
});

describe("intents", () => {
	test("come from the events a bot listens to", () => {
		const events = createEventRegistry([
			event("guildMemberAdd", () => {}),
			event("messageReactionAdd", () => {}),
			event("ready", () => {}),
		]);
		expect(intentNames(intentsFor(events))).toEqual([
			"Guilds",
			"GuildMembers",
			"GuildMessageReactions",
			"DirectMessageReactions",
		]);
	});

	test("interactions alone need only Guilds; extras are added on request", () => {
		expect(intentsFor(createEventRegistry([]))).toBe(I.Guilds);
		expect(intentsFor(createEventRegistry([]), I.MessageContent)).toBe(
			I.Guilds | I.MessageContent,
		);
	});
});

describe("restTransport", () => {
	const interaction = {
		id: "i1",
		token: "tok",
		application_id: "app",
	} as never;

	test("answers through the interaction's callback and webhook, without the bot token", async () => {
		const { rest, calls } = fakeRest();
		const transport = restTransport(rest, interaction);
		await transport.respond({ type: 5 });
		await transport.editOriginal({ content: "done" }, [
			{ name: "a.txt", data: "hi" },
		]);
		await transport.followUp({ content: "more" });
		await transport.deleteOriginal();

		expect(calls.map((c) => `${c.method} ${c.route}`)).toEqual([
			"post /interactions/i1/tok/callback",
			"patch /webhooks/app/tok/messages/%40original",
			"post /webhooks/app/tok",
			"delete /webhooks/app/tok/messages/%40original",
		]);
		expect(calls.every((c) => c.options?.auth === false)).toBe(true);
		expect(calls[1]?.options?.files).toEqual([
			{ key: "files[0]", name: "a.txt", contentType: undefined, data: "hi" },
		]);
	});

	test("explains an expired token", async () => {
		const rest = {
			...fakeRest().rest,
			patch: async () => {
				throw Object.assign(new Error("Unknown Webhook"), { code: 10015 });
			},
		};
		await expect(
			restTransport(rest, interaction).editOriginal({ content: "x" }),
		).rejects.toThrow(/15 minutes/);
	});
});

describe("syncCommands", () => {
	test("writes slash and menu commands in one overwrite to the test server", async () => {
		const { rest, calls } = fakeRest([]);
		const result = await syncCommands({
			rest,
			applicationId: "app",
			project: project(),
			guildId: "g1",
		});

		expect(result).toMatchObject({ applied: true, scope: "guild" });
		expect(calls.map((c) => `${c.method} ${c.route}`)).toEqual([
			"get /applications/app/guilds/g1/commands",
			"put /applications/app/guilds/g1/commands",
		]);
		expect(
			((calls[1]?.options?.body ?? []) as { name: string }[]).map(
				(c) => c.name,
			),
		).toEqual(["ping", "Profile"]);
	});

	test("doesn't write when nothing changed, or on a dry run", async () => {
		const first = fakeRest([]);
		await syncCommands({
			rest: first.rest,
			applicationId: "app",
			project: project(),
		});
		const registered = ((first.calls[1]?.options?.body ?? []) as object[]).map(
			(payload, i) => ({
				id: String(i),
				application_id: "app",
				version: "1",
				...payload,
			}),
		);

		const again = fakeRest(registered);
		const unchanged = await syncCommands({
			rest: again.rest,
			applicationId: "app",
			project: project(),
		});
		expect(unchanged.applied).toBe(false);
		expect(again.calls.map((c) => c.method)).toEqual(["get"]);

		const dry = fakeRest([]);
		const planned = await syncCommands({
			rest: dry.rest,
			applicationId: "app",
			project: project(),
			dryRun: true,
		});
		expect(planned.plan.create).toHaveLength(2);
		expect(dry.calls.map((c) => c.method)).toEqual(["get"]);
	});
});

describe("createBot", () => {
	function fakeGateway() {
		let listener: (
			payload: GatewayDispatchPayload,
			shardId: number,
		) => void = () => {};
		let connected = false;
		const gateway: GatewayLike = {
			on: (_event, fn) => {
				listener = fn;
			},
			connect: async () => {
				connected = true;
			},
			destroy: () => {
				connected = false;
			},
		};
		return {
			gateway,
			emit: (t: string, d: unknown) =>
				listener({ op: 0, s: 1, t, d } as never, 0),
			isConnected: () => connected,
		};
	}

	test("answers interactions over REST and hands other events to handlers", async () => {
		const joined: string[] = [];
		const { rest, calls } = fakeRest();
		const fake = fakeGateway();
		let intents = 0;
		const bot = createBot({
			token: "t",
			project: project({
				events: createEventRegistry([
					event("guildMemberAdd", (m) => joined.push(m.user.id)),
				]),
			}),
			rest,
			gateway: (options) => {
				intents = options.intents;
				return fake.gateway;
			},
		});

		await bot.start();
		expect(fake.isConnected()).toBe(true);
		expect(intents).toBe(I.Guilds | I.GuildMembers);

		fake.emit("INTERACTION_CREATE", {
			id: "i1",
			application_id: "app",
			token: "tok",
			type: 2,
			user: { id: "u1" },
			data: { id: "c1", type: 1, name: "ping" },
		});
		fake.emit("GUILD_MEMBER_ADD", { guild_id: "g1", user: { id: "u9" } });
		await new Promise((resolve) => setTimeout(resolve, 10));

		expect(calls[0]).toMatchObject({
			method: "post",
			route: "/interactions/i1/tok/callback",
			options: { body: { type: 4, data: { content: "pong" } } },
		});
		expect(joined).toEqual(["u9"]);

		await bot.stop();
		expect(fake.isConnected()).toBe(false);
	});
});

describe("api in handlers", () => {
	test("event handlers and commands get the typed API, sent through the bot's REST client", async () => {
		const { rest, calls } = fakeRest();
		let listener: (
			payload: GatewayDispatchPayload,
			shardId: number,
		) => void = () => {};
		const bot = createBot({
			token: "t",
			project: project({
				tree: buildCommandTree([
					{
						path: ["ban"],
						definition: command({
							description: "Ban",
							// Typed: banUser(guildId, userId, body?, options?)
							run: async ({ api, interaction, reply }) => {
								await api.guilds.banUser(interaction.guild_id ?? "", "u2", {
									delete_message_seconds: 60,
								});
								await reply("banned");
							},
						}),
					},
				]),
				events: createEventRegistry([
					event("messageReactionAdd", async (reaction, { api }) => {
						await api.channels.createMessage(reaction.channel_id, {
							content: `${reaction.emoji.name} noted`,
						});
					}),
				]),
			}),
			rest,
			gateway: () => ({
				on: (_event, fn) => {
					listener = fn;
				},
				connect: async () => {},
				destroy: () => {},
			}),
		});
		await bot.start();

		listener(
			{
				op: 0,
				s: 1,
				t: "MESSAGE_REACTION_ADD",
				d: { channel_id: "c1", emoji: { name: "👀" } },
			} as never,
			0,
		);
		listener(
			{
				op: 0,
				s: 2,
				t: "INTERACTION_CREATE",
				d: {
					id: "i1",
					application_id: "app",
					token: "tok",
					type: 2,
					guild_id: "g1",
					member: { user: { id: "u1" }, roles: [], permissions: "0" },
					data: { id: "c1", type: 1, name: "ban" },
				},
			} as never,
			0,
		);
		await new Promise((resolve) => setTimeout(resolve, 20));

		const routes = calls.map((c) => `${c.method} ${c.route}`);
		expect(routes).toContain("post /channels/c1/messages");
		expect(routes).toContain("put /guilds/g1/bans/u2");
		expect(
			calls.find((c) => c.route === "/channels/c1/messages")?.options?.body,
		).toEqual({
			content: "👀 noted",
		});
	});
});
