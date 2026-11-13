import pkg from "../package.json" with { type: "json" };

const HELP = `nubis ${pkg.version}

Usage: nubis <command>

Commands:
  dev               Sync commands to your test server and run the bot, restarting on changes
  start             Run the bot
  sync [--global]   Register commands with Discord (your test server, or --global for everywhere)
       [--dry-run]  Show what would change without changing it

Settings come from .env: DISCORD_TOKEN, DISCORD_APPLICATION_ID and, for dev
and sync, DISCORD_DEV_GUILD_ID.

Options:
  -v, --version  Print the version
  -h, --help     Print this help`;

export type CliResult =
	| { readonly code: number; readonly output: string }
	/** A command that talks to Discord; cli.ts runs it. */
	| {
			readonly run: "dev" | "start" | "sync";
			readonly args: readonly string[];
	  };

export function runCli(args: readonly string[]): CliResult {
	const [first, ...rest] = args;

	if (first === "-v" || first === "--version") {
		return { code: 0, output: pkg.version };
	}
	if (first === undefined || first === "-h" || first === "--help") {
		return { code: 0, output: HELP };
	}
	if (first === "dev" || first === "start" || first === "sync") {
		return { run: first, args: rest };
	}
	return { code: 1, output: `Unknown command: ${first}\n\n${HELP}` };
}
