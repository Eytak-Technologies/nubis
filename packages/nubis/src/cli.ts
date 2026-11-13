#!/usr/bin/env node
import { runCli } from "./run-cli";

const result = runCli(process.argv.slice(2));

if ("run" in result) {
	// Loaded on demand so `nubis --help` doesn't pull in the gateway client.
	const commands = await import("./commands");
	const cwd = process.cwd();
	const run = {
		dev: () => commands.runDev(cwd),
		start: () => commands.runStart(cwd),
		sync: () => commands.runSync(cwd, result.args),
	}[result.run];
	try {
		process.exitCode = await run();
	} catch (error) {
		console.error(
			`[nubis] ${error instanceof Error ? error.message : String(error)}`,
		);
		process.exitCode = 1;
	}
} else {
	(result.code === 0 ? console.log : console.error)(result.output);
	process.exitCode = result.code;
}
