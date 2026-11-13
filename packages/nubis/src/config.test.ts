import { describe, expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	buildCommandTree,
	command,
	createComponentRegistry,
	createEventRegistry,
	guard,
	type NubisApi,
} from "@nubisjs/core";
import {
	ActivityType,
	GatewayIntentBits as I,
	PresenceUpdateStatus,
} from "discord-api-types/v10";
import { createHttpServer } from "./commands";
import { defineConfig } from "./index";
import type { Project } from "./loader";
import {
	createBot,
	intentBits,
	loadConfig,
	presenceData,
	validateConfig,
} from "./node";

describe("validateConfig", () => {
	test("accepts a full config", () => {
		const config = defineConfig({
			root: "src",
			intents: ["MessageContent"],
			presence: {
				status: "idle",
				activity: { type: "watching", name: "the server" },
			},
			transport: "http",
			http: { port: 8080 },
			devGuildId: "1",
		});
		expect(validateConfig(config, "nubis.config.ts")).toBe(config);
	});

	test("names the file and the mistake", () => {
		const bad = (config: unknown) => () =>
			validateConfig(config, "nubis.config.ts");
		expect(bad({ intent: [] })).toThrow(
			/nubis.config.ts: "intent" isn't a config setting/,
		);
		expect(bad({ intents: ["MessageContnet"] })).toThrow(
			/"MessageContnet" isn't an intent/,
		);
		expect(bad({ presence: { status: "busy" } })).toThrow(
			/presence.status must be/,
		);
		expect(
			bad({ presence: { activity: { type: "streaming", name: "x" } } }),
		).toThrow(/presence.activity.type must be/);
		expect(bad({ transport: "websocket" })).toThrow(
			/transport must be "gateway" or "http"/,
		);
		expect(bad(undefined)).toThrow(/export the config as default/);
	});
});

describe("config values", () => {
	test("intent names become bits", () => {
		expect(intentBits(["MessageContent", "GuildPresences"])).toBe(
			I.MessageContent | I.GuildPresences,
		);
		expect(intentBits()).toBe(0);
	});

	test("presence becomes the gateway payload; custom uses state", () => {
		expect(
			presenceData({ activity: { type: "watching", name: "you" } }),
		).toEqual({
			since: null,
			afk: false,
			status: PresenceUpdateStatus.Online,
			activities: [{ type: ActivityType.Watching, name: "you" }],
		});
		expect(
			presenceData({
				status: "dnd",
				activity: { type: "custom", name: "Fixing bugs" },
			}),
		).toMatchObject({
			status: "dnd",
			activities: [
				{
					type: ActivityType.Custom,
					name: "Custom Status",
					state: "Fixing bugs",
				},
			],
		});
		expect(presenceData(undefined)).toBeUndefined();
	});
});

describe("loadConfig", () => {
	test("loads nubis.config.ts and resolves root", async () => {
		const dir = await mkdtemp(join(tmpdir(), "nubis-config-"));
		await writeFile(
			join(dir, "nubis.config.ts"),
			'export default { root: "src", presence: { activity: { type: "playing", name: "tests" } } };',
		);
		const loaded = await loadConfig(dir);
		expect(loaded.file).toBe(join(dir, "nubis.config.ts"));
		expect(loaded.root).toBe(join(dir, "src"));
		expect(loaded.config.presence?.activity?.name).toBe("tests");
	});

	test("a bot without one gets the defaults", async () => {
		const dir = await mkdtemp(join(tmpdir(), "nubis-noconfig-"));
		expect(await loadConfig(dir)).toEqual({
			config: {},
			file: undefined,
			root: dir,
		});
	});

	test("a broken config fails at startup", async () => {
		const dir = await mkdtemp(join(tmpdir(), "nubis-badconfig-"));
		await writeFile(
			join(dir, "nubis.config.ts"),
			"export default { prefix: '!' };",
		);
		await expect(loadConfig(dir)).rejects.toThrow(
			/"prefix" isn't a config setting/,
		);
	});
});

const project = (): Project => ({
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
	menus: [],
	events: createEventRegistry([]),
});

test("createBot connects with the configured presence", async () => {
	let presence: unknown;
	const bot = createBot({
		token: "t",
		project: project(),
		presence: presenceData({
			activity: { type: "listening", name: "commands" },
		}),
		rest: {
			get: async () => [],
			post: async () => ({}),
			put: async () => ({}),
			patch: async () => ({}),
			delete: async () => ({}),
		},
		gateway: (options) => {
			presence = options.presence;
			return { on: () => {}, connect: async () => {}, destroy: () => {} };
		},
	});
	await bot.start();
	expect(presence).toMatchObject({
		activities: [{ type: ActivityType.Listening, name: "commands" }],
	});
});

const keys = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
	"sign",
	"verify",
])) as CryptoKeyPair;
const hex = (buffer: ArrayBuffer) => Buffer.from(buffer).toString("hex");
const publicKey = hex(await crypto.subtle.exportKey("raw", keys.publicKey));

describe("createHttpServer", () => {
	async function serve(
		config: Parameters<typeof createHttpServer>[0]["config"],
	) {
		const server = createHttpServer({
			publicKey,
			project: project(),
			config,
			api: {} as NubisApi,
		});
		await new Promise<void>((resolve) => server.listen(0, resolve));
		const { port } = server.address() as AddressInfo;
		const post = async (path: string, body: object) => {
			const text = JSON.stringify(body);
			const timestamp = String(Math.floor(Date.now() / 1000));
			const signature = hex(
				await crypto.subtle.sign(
					{ name: "Ed25519" },
					keys.privateKey,
					new TextEncoder().encode(timestamp + text),
				),
			);
			return fetch(`http://127.0.0.1:${port}${path}`, {
				method: "POST",
				headers: {
					"x-signature-ed25519": signature,
					"x-signature-timestamp": timestamp,
				},
				body: text,
			});
		};
		return { server, post };
	}
	const ping = {
		id: "i1",
		application_id: "a",
		token: "t",
		type: 2,
		user: { id: "u1" },
		data: { id: "c", type: 1, name: "ping" },
	};

	test("answers on the configured path only", async () => {
		const { server, post } = await serve({ http: { path: "/discord" } });
		try {
			expect((await post("/interactions", ping)).status).toBe(404);
			const response = await post("/discord", ping);
			expect(await response.json()).toMatchObject({
				type: 4,
				data: { content: "pong" },
			});
		} finally {
			server.close();
		}
	});

	test("applies the config's guards", async () => {
		const { server, post } = await serve({
			guards: [guard(({ deny }) => deny("Maintenance."))],
		});
		try {
			const response = await post("/interactions", ping);
			expect(await response.json()).toMatchObject({
				data: { content: "Maintenance.", flags: 64 },
			});
		} finally {
			server.close();
		}
	});
});
