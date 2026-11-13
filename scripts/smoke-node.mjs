// Runs the built packages under plain Node (no Bun) so a Bun-only API in
// published code fails CI instead of failing users.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve as resolvePath } from "node:path";

const nubis = await import("../packages/nubis/dist/index.js");

/** Records message text the way a real transport would send it. */
const transportFor = (texts) => ({
	respond: async (response) => {
		if (response.data?.content) texts.push(response.data.content);
	},
	editOriginal: async (body) => texts.push(body.content),
	deleteOriginal: async () => {},
	followUp: async (body) => texts.push(body.content),
});
assert.equal(typeof nubis.command, "function");
assert.equal(typeof nubis.option.string, "function");

const ping = nubis.command({
	description: "Replies with pong",
	options: { loud: nubis.option.boolean() },
	run: () => {},
});
assert.equal(ping.kind, "command");
assert.equal(ping.options.loud.kind, "boolean");

// Routing, serialization and dispatch through the published entry point.
const tree = nubis.buildCommandTree([{ path: ["ping"], definition: ping }]);
const [payload] = nubis.toCommandPayloads(tree);
assert.equal(payload.name, "ping");
assert.equal(payload.options[0].type, 5); // Boolean
const replies = [];
const pong = nubis.command({
	description: "Pong",
	run: ({ reply }) => reply("pong"),
});
const result = await nubis.dispatch(
	nubis.buildCommandTree([{ path: ["pong"], definition: pong }]),
	{ type: 2, user: { id: "u1" }, data: { name: "pong", type: 1 } },
	transportFor(replies),
);
assert.equal(result.status, "handled");
assert.deepEqual(replies, ["pong"]);

// Typed components: render, then route a click back with its state.
const clicks = [];
const confirm = nubis.button({
	id: "confirm",
	label: "Confirm",
	state: nubis.stateOf(),
	onClick: ({ state }) => clicks.push(state.userId),
});
const rendered = confirm({ userId: "42" });
const clicked = await nubis.dispatchComponent(
	nubis.createComponentRegistry([confirm]),
	{
		type: 3,
		user: { id: "u1" },
		data: { custom_id: rendered.custom_id, component_type: 2 },
	},
	transportFor([]),
);
assert.equal(clicked.status, "handled");
assert.deepEqual(clicks, ["42"]);

// Modals: render, then route a submission back with typed values.
const reports = [];
const report = nubis.modal({
	id: "report",
	title: "Report",
	fields: { player: nubis.textInput({ label: "Player", required: true }) },
	onSubmit: ({ values }) => reports.push(values.player),
});
assert.equal(report().components[0].component.custom_id, "player");
const submittedReport = await nubis.dispatchModal(
	nubis.createComponentRegistry([report]),
	{
		type: 5,
		user: { id: "u1" },
		data: {
			custom_id: "report",
			components: [
				{
					type: 18,
					component: { type: 4, custom_id: "player", value: "Steve" },
				},
			],
		},
	},
	transportFor([]),
);
assert.equal(submittedReport.status, "handled");
assert.deepEqual(reports, ["Steve"]);

// Reply lifecycle: a slow command gets "thinking…" first, then its reply.
const trace = [];
const slow = nubis.command({
	description: "Slow",
	run: async ({ reply }) => {
		await new Promise((resolve) => setTimeout(resolve, 30));
		await reply("finally");
	},
});
await nubis.dispatch(
	nubis.buildCommandTree([{ path: ["slow"], definition: slow }]),
	{ type: 2, user: { id: "u1" }, data: { name: "slow", type: 1 } },
	{
		respond: async (response) => trace.push(`respond:${response.type}`),
		editOriginal: async (body) => trace.push(`edit:${body.content}`),
		deleteOriginal: async () => trace.push("delete"),
		followUp: async () => trace.push("followUp"),
	},
	{ autoDeferMs: 10 },
);
assert.deepEqual(trace, ["respond:5", "edit:finally"]);

// Guards: permission bits are BigInt on every runtime.
const denied = [];
const ban = nubis.command({
	description: "Ban",
	guards: [nubis.hasPermission(1n << 2n)], // BanMembers
	run: () => denied.push("ran"),
});
const banResult = await nubis.dispatch(
	nubis.buildCommandTree([{ path: ["ban"], definition: ban }]),
	{
		type: 2,
		guild_id: "g1",
		member: { user: { id: "u1" }, roles: [], permissions: "2048" }, // SendMessages only
		data: { name: "ban", type: 1 },
	},
	transportFor(denied),
	{ autoDeferMs: false },
);
assert.equal(banResult.status, "denied");
assert.deepEqual(denied, ["You don't have permission to do that."]);

// Autocomplete: suggestions answered with type 8.
const searchTree = nubis.buildCommandTree([
	{
		path: ["search"],
		definition: nubis.command({
			description: "Search",
			options: {
				q: nubis.option.string({
					autocomplete: ({ value }) => [{ name: value, value }],
				}),
			},
			run: () => {},
		}),
	},
]);
let suggested;
await nubis.dispatchAutocomplete(
	searchTree,
	{
		type: 4,
		user: { id: "u1" },
		data: {
			name: "search",
			type: 1,
			options: [{ type: 3, name: "q", value: "abc", focused: true }],
		},
	},
	{ respond: async (response) => (suggested = response) },
);
assert.deepEqual(suggested, {
	type: 8,
	data: { choices: [{ name: "abc", value: "abc" }] },
});

const { version } = JSON.parse(
	readFileSync(new URL("../packages/nubis/package.json", import.meta.url)),
);
const cli = (file, args) =>
	execFileSync(process.execPath, [file, ...args], { encoding: "utf8" }).trim();

assert.equal(cli("packages/nubis/dist/cli.js", ["--version"]), version);
// create-nubis writes a real project; do it in a temp folder.
const scratch = mkdtempSync(join(tmpdir(), "nubis-smoke-"));
const created = execFileSync(
	process.execPath,
	[
		resolvePath("packages/create-nubis/dist/index.js"),
		"ticket-bot",
		"--pm",
		"npm",
	],
	{ cwd: scratch, encoding: "utf8" },
);
assert.match(created, /Created ticket-bot/);
const generated = JSON.parse(
	readFileSync(join(scratch, "ticket-bot", "package.json"), "utf8"),
);
assert.equal(generated.name, "ticket-bot");
assert.equal(generated.scripts.test, "vitest run");

// Context menus and events.
const menuReplies = [];
const reportMenu = nubis.messageCommand({
	name: "Report message",
	run: ({ target, reply }) => reply(`reported ${target.id}`),
});
await nubis.dispatchMenu(
	[reportMenu],
	{
		type: 2,
		user: { id: "u1" },
		data: {
			type: 3,
			name: "Report message",
			target_id: "m1",
			resolved: { messages: { m1: { id: "m1" } } },
		},
	},
	transportFor(menuReplies),
	{ autoDeferMs: false },
);
assert.deepEqual(menuReplies, ["reported m1"]);
assert.equal(nubis.toMenuPayloads([reportMenu])[0].type, 3);

const joined = [];
const events = nubis.createEventRegistry([
	nubis.event("guildMemberAdd", (member) => joined.push(member.user.id)),
]);
const eventResult = await nubis.dispatchEvent(events, "GUILD_MEMBER_ADD", {
	user: { id: "u9" },
});
assert.equal(eventResult.handled, 1);
assert.deepEqual(joined, ["u9"]);

// State stores use Web Crypto for keys: present on every supported Node.
const picked = [];
const store = nubis.memoryStore();
const pickUser = nubis.userSelect({
	id: "pick-user",
	state: nubis.stateOf(),
	store,
	onSelect: ({ users, state }) => picked.push(`${users[0].id}:${state.note}`),
});
const renderedSelect = pickUser({ note: "x".repeat(150) });
assert.match(renderedSelect.custom_id, /^pick-user~\$[\w-]{16}$/);
const selected = await nubis.dispatchComponent(
	nubis.createComponentRegistry([pickUser]),
	{
		type: 3,
		user: { id: "u1" },
		data: {
			custom_id: renderedSelect.custom_id,
			component_type: 5,
			values: ["u2"],
			resolved: { users: { u2: { id: "u2" } } },
		},
	},
	transportFor([]),
	{ autoDeferMs: false },
);
assert.equal(selected.status, "handled");
assert.deepEqual(picked, [`u2:${"x".repeat(150)}`]);

// The loader reads a JavaScript project from disk under plain Node.
const { loadProject } = await import("../packages/nubis/dist/node.js");
const project = await loadProject(
	new URL("./fixtures/project", import.meta.url).pathname,
);
assert.deepEqual([...project.tree.keys()], ["ping", "tools"]);
const [, tools] = nubis.toCommandPayloads(project.tree);
assert.equal(tools.description, "Handy tools");
assert.equal(project.events.get("ready").length, 1);

// HTTP interactions: Ed25519 through Web Crypto must work on every supported Node.
const keyPair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
	"sign",
	"verify",
]);
const hex = (buffer) => Buffer.from(buffer).toString("hex");
const handle = nubis.createInteractionHandler({
	publicKey: hex(await crypto.subtle.exportKey("raw", keyPair.publicKey)),
	project,
});
const pingBody = JSON.stringify({
	id: "i1",
	application_id: "a1",
	token: "t",
	type: 2,
	user: { id: "u1" },
	data: { id: "c1", type: 1, name: "ping" },
});
const stamp = String(Math.floor(Date.now() / 1000));
const httpResponse = await handle(
	new Request("http://bot.test/", {
		method: "POST",
		headers: {
			"x-signature-ed25519": hex(
				await crypto.subtle.sign(
					{ name: "Ed25519" },
					keyPair.privateKey,
					new TextEncoder().encode(stamp + pingBody),
				),
			),
			"x-signature-timestamp": stamp,
		},
		body: pingBody,
	}),
);
assert.equal(httpResponse.status, 200);
assert.deepEqual((await httpResponse.json()).data.content, "pong");

const forged = await handle(
	new Request("http://bot.test/", {
		method: "POST",
		headers: {
			"x-signature-ed25519": "00".repeat(64),
			"x-signature-timestamp": stamp,
		},
		body: pingBody,
	}),
);
assert.equal(forged.status, 401);

// Files go out as multipart through the webhook: FormData and Blob on plain Node.
const uploads = [];
const filesHandle = nubis.createInteractionHandler({
	publicKey: hex(await crypto.subtle.exportKey("raw", keyPair.publicKey)),
	project: {
		tree: nubis.buildCommandTree([
			{
				path: ["ping"],
				definition: nubis.command({
					description: "Ping",
					run: ({ reply }) =>
						reply({ files: [{ name: "a.txt", data: "hello" }] }),
				}),
			},
		]),
		components: nubis.createComponentRegistry([]),
		menus: [],
	},
	fetch: async (_url, init) => {
		uploads.push(await init.body.get("files[0]").text());
		return new Response("{}");
	},
	waitUntil: (work) => uploads.push(work),
});
const filesResponse = await filesHandle(
	new Request("http://bot.test/", {
		method: "POST",
		headers: {
			"x-signature-ed25519": hex(
				await crypto.subtle.sign(
					{ name: "Ed25519" },
					keyPair.privateKey,
					new TextEncoder().encode(stamp + pingBody),
				),
			),
			"x-signature-timestamp": stamp,
		},
		body: pingBody,
	}),
);
assert.equal((await filesResponse.json()).type, 5);
await uploads.shift();
assert.deepEqual(uploads, ["hello"]);

// nubis/testing runs commands without Discord on plain Node.
const testing = await import("../packages/nubis/dist/testing.js");
const greet = nubis.command({
	description: "Greet",
	options: { who: nubis.option.user({ required: true }) },
	run: ({ options, reply }) => reply(`hi ${options.who.username}`),
});
const tested = await testing
	.testCommand(greet)
	.run({ who: testing.fake.user("alice") });
assert.deepEqual(tested.replies, ["hi alice"]);

// The gateway bot and command sync load and work on plain Node (fake network).
const nodeEntry = await import("../packages/nubis/dist/node.js");
const restCalls = [];
const fakeRestClient = Object.fromEntries(
	["get", "post", "put", "patch", "delete"].map((method) => [
		method,
		async (route, options) => {
			restCalls.push(`${method} ${route}`);
			return method === "get" ? [] : options;
		},
	]),
);
const synced = await nodeEntry.syncCommands({
	rest: fakeRestClient,
	applicationId: "a1",
	project,
	guildId: "g1",
});
assert.equal(synced.applied, true);
let dispatchListener;
const bot = nodeEntry.createBot({
	token: "t",
	project,
	rest: fakeRestClient,
	gateway: () => ({
		on: (_event, fn) => {
			dispatchListener = fn;
		},
		connect: async () => {},
		destroy: () => {},
	}),
});
await bot.start();
dispatchListener(
	{
		op: 0,
		t: "INTERACTION_CREATE",
		d: {
			id: "i1",
			application_id: "a1",
			token: "tok",
			type: 2,
			user: { id: "u1" },
			data: { id: "c1", type: 1, name: "ping" },
		},
	},
	0,
);
await new Promise((resolve) => setTimeout(resolve, 20));
assert.ok(restCalls.includes("post /interactions/i1/tok/callback"));
await bot.stop();

console.log(`Node ${process.version}: smoke test passed`);
