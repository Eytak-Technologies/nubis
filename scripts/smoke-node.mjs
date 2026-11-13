// Runs the built packages under plain Node (no Bun) so a Bun-only API in
// published code fails CI instead of failing users.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

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
assert.match(
	cli("packages/create-nubis/dist/index.js", ["ticket-bot"]),
	/ticket-bot/,
);

console.log(`Node ${process.version}: smoke test passed`);
