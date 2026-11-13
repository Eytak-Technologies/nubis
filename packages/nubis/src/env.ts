import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";

/** Parses KEY=VALUE lines. Quotes are optional; `#` starts a comment line. */
export function parseEnv(text: string): Record<string, string> {
	const values: Record<string, string> = {};
	for (const raw of text.split(/\r?\n/)) {
		const line = raw.trim();
		if (!line || line.startsWith("#")) continue;
		const at = line.indexOf("=");
		if (at === -1) continue;
		const key = line
			.slice(0, at)
			.replace(/^export\s+/, "")
			.trim();
		let value = line.slice(at + 1).trim();
		if (
			(value.startsWith('"') && value.endsWith('"')) ||
			(value.startsWith("'") && value.endsWith("'"))
		) {
			value = value.slice(1, -1);
		}
		values[key] = value;
	}
	return values;
}

/**
 * Loads the nearest `.env`, looking in `start` and then its parents, into
 * `target` without overriding what's already set. Returns the file it used.
 */
export async function loadEnv(
	start: string,
	target: Record<string, string | undefined> = process.env,
): Promise<string | undefined> {
	let dir = start;
	for (;;) {
		const file = join(dir, ".env");
		const text = await readFile(file, "utf8").catch(() => undefined);
		if (text !== undefined) {
			for (const [key, value] of Object.entries(parseEnv(text))) {
				target[key] ??= value;
			}
			return file;
		}
		const parent = dirname(dir);
		if (parent === dir) return undefined;
		dir = parent;
	}
}

export interface DiscordEnv {
	readonly token: string;
	readonly applicationId: string;
	readonly publicKey: string | undefined;
	readonly devGuildId: string | undefined;
}

/** Reads the DISCORD_* settings, naming any that are missing. */
export function discordEnv(
	env: Record<string, string | undefined> = process.env,
): DiscordEnv {
	const missing = ["DISCORD_TOKEN", "DISCORD_APPLICATION_ID"].filter(
		(key) => !env[key],
	);
	if (missing.length > 0) {
		throw new Error(
			`Missing ${missing.join(" and ")}. Put them in a .env file next to your bot (see .env.example).`,
		);
	}
	return {
		token: env.DISCORD_TOKEN as string,
		applicationId: env.DISCORD_APPLICATION_ID as string,
		publicKey: env.DISCORD_PUBLIC_KEY || undefined,
		devGuildId: env.DISCORD_DEV_GUILD_ID || undefined,
	};
}
