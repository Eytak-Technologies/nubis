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
