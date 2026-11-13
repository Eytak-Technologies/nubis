#!/usr/bin/env node
import { resolve } from "node:path";
import pkg from "../package.json" with { type: "json" };
import { createProject, detectPackageManager, nubisRange } from "./create";
import { resolveProjectName } from "./project-name";
import type { PackageManager } from "./templates";

const MANAGERS = ["bun", "npm", "pnpm", "yarn"] as const;

function flag(args: readonly string[], name: string): string | undefined {
	const index = args.indexOf(name);
	return index === -1 ? undefined : args[index + 1];
}

async function main(args: readonly string[]): Promise<void> {
	const pmFlag = flag(args, "--pm");
	if (pmFlag !== undefined && !MANAGERS.includes(pmFlag as PackageManager)) {
		throw new Error(`--pm must be one of ${MANAGERS.join(", ")}.`);
	}
	const packageManager =
		(pmFlag as PackageManager | undefined) ??
		detectPackageManager(process.env.npm_config_user_agent);
	const name = resolveProjectName(
		args.filter((arg, i) => !(args[i - 1] === "--pm") && arg !== "--pm"),
	);
	const dir = resolve(name);

	await createProject(dir, {
		name: name.split("/").at(-1) ?? name,
		packageManager,
		nubisVersion: nubisRange(pkg.version),
	});

	const run = packageManager === "npm" ? "npm run" : packageManager;
	console.log(`
Created ${name} with Nubis.

  cd ${name}
  ${packageManager} install
  ${run} test

Then add your bot's token to .env (see .env.example) and run \`${run} dev\`.
`);
}

main(process.argv.slice(2)).catch((error: unknown) => {
	console.error(error instanceof Error ? error.message : error);
	process.exitCode = 1;
});
