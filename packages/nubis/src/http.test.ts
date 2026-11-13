import { describe, expect, test } from "bun:test";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import {
	buildCommandTree,
	button,
	command,
	createComponentRegistry,
	option,
} from "@nubisjs/core";
import {
	createInteractionHandler,
	type InteractionProject,
	type InteractionResult,
	verifyDiscordRequest,
} from "./index";
import { toNodeListener } from "./node";

const keys = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
	"sign",
	"verify",
])) as CryptoKeyPair;
const toHex = (bytes: ArrayBuffer) =>
	[...new Uint8Array(bytes)]
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
const publicKey = toHex(await crypto.subtle.exportKey("raw", keys.publicKey));

async function signed(body: object, options: { tamper?: boolean } = {}) {
	const text = JSON.stringify(body);
	const timestamp = String(Math.floor(Date.now() / 1000));
	const signature = toHex(
		await crypto.subtle.sign(
			{ name: "Ed25519" },
			keys.privateKey,
			new TextEncoder().encode(timestamp + text),
		),
	);
	return new Request("http://bot.test/interactions", {
		method: "POST",
		headers: {
			"x-signature-ed25519": signature,
			"x-signature-timestamp": timestamp,
			"content-type": "application/json",
		},
		body: options.tamper ? text.replace("ping", "pong") : text,
	});
}

const base = {
	id: "i1",
	application_id: "app1",
	token: "tok",
	version: 1,
	user: { id: "u1", username: "tester" },
};
const slash = (name: string, options?: unknown[]) => ({
	...base,
	type: 2,
	data: { id: "c1", type: 1, name, ...(options ? { options } : {}) },
});

/** A fetch that records Discord API calls and answers them. */
function fakeDiscord(status = 200, body = "{}") {
	const calls: { method: string; url: string; body: unknown }[] = [];
	const fetcher = (async (url: string, init?: RequestInit) => {
		const raw = init?.body;
		calls.push({
			method: init?.method ?? "GET",
			url,
			body:
				raw instanceof FormData
					? {
							payload: JSON.parse(String(raw.get("payload_json"))),
							files: await Promise.all(
								[...raw.entries()]
									.filter(([key]) => key.startsWith("files["))
									.map(async ([key, file]) => ({
										key,
										name: (file as unknown as File).name,
										text: await (file as unknown as File).text(),
									})),
							),
						}
					: raw
						? JSON.parse(String(raw))
						: undefined,
		});
		return new Response(body, { status });
	}) as typeof fetch;
	return { calls, fetcher };
}

const project: InteractionProject = {
	tree: buildCommandTree([
		{
			path: ["ping"],
			definition: command({
				description: "Ping",
				run: ({ reply }) => reply("pong"),
			}),
		},
		{
			path: ["slow"],
			definition: command({
				description: "Slow",
				run: async ({ reply }) => {
					await new Promise((resolve) => setTimeout(resolve, 30));
					await reply("done");
					await reply("and one more");
				},
			}),
		},
		{
			path: ["search"],
			definition: command({
				description: "Search",
				options: {
					q: option.string({
						autocomplete: ({ value }) => [{ name: value, value }],
					}),
				},
				run: () => {},
			}),
		},
		{
			path: ["silent"],
			definition: command({ description: "Silent", run: () => {} }),
		},
		{
			path: ["export"],
			definition: command({
				description: "Export",
				ephemeral: true,
				run: ({ reply }) =>
					reply({
						content: "Here you go",
						files: [{ name: "players.csv", data: "name\nalice" }],
					}),
			}),
		},
	]),
	components: createComponentRegistry([
		button({
			id: "bump",
			label: "Bump",
			onClick: ({ update }) => update("bumped"),
		}),
	]),
	menus: [],
};

function handlerWith(
	extra: Partial<Parameters<typeof createInteractionHandler>[0]> = {},
) {
	const discord = fakeDiscord();
	const work: Promise<unknown>[] = [];
	const results: InteractionResult[] = [];
	const handle = createInteractionHandler({
		publicKey,
		project,
		fetch: discord.fetcher,
		waitUntil: (promise) => work.push(promise),
		onResult: (result) => results.push(result),
		dispatch: { autoDeferMs: 10 },
		...extra,
	});
	return { handle, discord, results, settled: () => Promise.all(work) };
}

describe("signatures", () => {
	test("verifyDiscordRequest accepts Discord's signature and nothing else", async () => {
		const request = await signed({ type: 1 });
		const signature = request.headers.get("x-signature-ed25519") ?? "";
		const timestamp = request.headers.get("x-signature-timestamp") ?? "";
		const body = await request.text();

		expect(
			await verifyDiscordRequest(publicKey, signature, timestamp, body),
		).toBe(true);
		expect(
			await verifyDiscordRequest(publicKey, signature, timestamp, `${body} `),
		).toBe(false);
		expect(await verifyDiscordRequest(publicKey, "zz", timestamp, body)).toBe(
			false,
		);
	});

	test("unsigned or tampered requests get 401, other methods 405", async () => {
		const { handle } = handlerWith();
		expect(
			(await handle(await signed(slash("ping"), { tamper: true }))).status,
		).toBe(401);
		expect(
			(
				await handle(
					new Request("http://bot.test/", { method: "POST", body: "{}" }),
				)
			).status,
		).toBe(401);
		expect((await handle(new Request("http://bot.test/"))).status).toBe(405);
	});

	test("a malformed public key fails at startup", () => {
		expect(() =>
			createInteractionHandler({ publicKey: "nope", project }),
		).toThrow(/64 hex characters/);
	});
});

describe("answering", () => {
	test("PING is answered with PONG", async () => {
		const { handle } = handlerWith();
		expect(
			await (await handle(await signed({ ...base, type: 1 }))).json(),
		).toEqual({ type: 1 });
	});

	test("a quick reply is the HTTP response itself", async () => {
		const { handle, discord, settled } = handlerWith();
		const response = await handle(await signed(slash("ping")));
		await settled();

		expect(await response.json()).toMatchObject({
			type: 4,
			data: { content: "pong" },
		});
		expect(discord.calls).toEqual([]);
	});

	test("a slow command answers thinking… over HTTP, then edits through the webhook", async () => {
		const { handle, discord, results, settled } = handlerWith();
		const response = await handle(await signed(slash("slow")));
		expect(await response.json()).toEqual({ type: 5, data: {} });

		await settled();
		expect(discord.calls.map((call) => `${call.method} ${call.url}`)).toEqual([
			"PATCH https://discord.com/api/v10/webhooks/app1/tok/messages/@original",
			"POST https://discord.com/api/v10/webhooks/app1/tok",
		]);
		expect(discord.calls[0]?.body).toMatchObject({ content: "done" });
		expect(results[0]?.status).toBe("handled");
	});

	test("components and autocomplete route to their dispatchers", async () => {
		const { handle } = handlerWith();
		const click = await handle(
			await signed({
				...base,
				type: 3,
				data: { custom_id: "bump", component_type: 2 },
			}),
		);
		expect(await click.json()).toMatchObject({
			type: 7,
			data: { content: "bumped" },
		});

		const suggest = await handle(
			await signed({
				...base,
				type: 4,
				data: {
					name: "search",
					type: 1,
					options: [{ type: 3, name: "q", value: "ab", focused: true }],
				},
			}),
		);
		expect(await suggest.json()).toEqual({
			type: 8,
			data: { choices: [{ name: "ab", value: "ab" }] },
		});
	});

	test("a handler that never answers gets a 500, and the result says so", async () => {
		const { handle, results, settled } = handlerWith({
			dispatch: { autoDeferMs: false },
		});
		const response = await handle(await signed(slash("silent")));
		await settled();
		expect(response.status).toBe(500);
		expect(results[0]).toMatchObject({ status: "handled" });
	});

	test("a reply with files acknowledges over HTTP and uploads through the webhook", async () => {
		const { handle, discord, settled } = handlerWith();
		const response = await handle(await signed(slash("export")));
		// Visibility survives the detour: the "thinking…" is ephemeral too.
		expect(await response.json()).toEqual({ type: 5, data: { flags: 64 } });

		await settled();
		expect(discord.calls).toHaveLength(1);
		const [edit] = discord.calls;
		expect(`${edit?.method} ${edit?.url}`).toBe(
			"PATCH https://discord.com/api/v10/webhooks/app1/tok/messages/@original",
		);
		expect(edit?.body).toMatchObject({
			payload: {
				content: "Here you go",
				attachments: [{ id: 0, filename: "players.csv" }],
			},
			files: [{ key: "files[0]", name: "players.csv", text: "name\nalice" }],
		});
	});

	test("an expired token explains Discord's 15-minute limit", async () => {
		const expired = fakeDiscord(
			404,
			JSON.stringify({ code: 10015, message: "Unknown Webhook" }),
		);
		const { handle, results, settled } = handlerWith({
			fetch: expired.fetcher,
		});
		await handle(await signed(slash("slow")));
		await settled();

		expect(results[0]?.status).toBe("error");
		expect(String(results[0]?.error)).toMatch(/expired.*15 minutes/);
	});
});

describe("toNodeListener", () => {
	test("serves the handler over node:http", async () => {
		const { handle } = handlerWith();
		const server = createServer(toNodeListener(handle));
		await new Promise<void>((resolve) => server.listen(0, resolve));
		const { port } = server.address() as AddressInfo;
		try {
			const request = await signed(slash("ping"));
			const response = await fetch(`http://127.0.0.1:${port}/interactions`, {
				method: "POST",
				headers: request.headers,
				body: await request.text(),
			});
			expect(await response.json()).toMatchObject({
				type: 4,
				data: { content: "pong" },
			});
		} finally {
			server.close();
		}
	});
});
