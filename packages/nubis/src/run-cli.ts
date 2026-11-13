import pkg from "../package.json" with { type: "json" };

const HELP = `nubis ${pkg.version}

Usage: nubis <command>

Commands:
  dev      Start the bot with hot reload (not implemented yet)
  build    Build the bot for production (not implemented yet)

Options:
  -v, --version  Print the version
  -h, --help     Print this help`;

export interface CliResult {
	readonly code: number;
	readonly output: string;
}

export function runCli(args: readonly string[]): CliResult {
	const [first] = args;

	if (first === "-v" || first === "--version") {
		return { code: 0, output: pkg.version };
	}
	if (first === undefined || first === "-h" || first === "--help") {
		return { code: 0, output: HELP };
	}
	if (first === "dev" || first === "build") {
		return { code: 1, output: `nubis ${first} is not implemented yet.` };
	}
	return { code: 1, output: `Unknown command: ${first}\n\n${HELP}` };
}
