// Runs the built packages under plain Node (no Bun) so a Bun-only API in
// published code fails CI instead of failing users.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const nubis = await import("../packages/nubis/dist/index.js");
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
	{ data: { name: "pong", type: 1 } },
	{ reply: async (content) => replies.push(content) },
);
assert.equal(result.status, "handled");
assert.deepEqual(replies, ["pong"]);

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
