import { access } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { type NubisConfig, validateConfig } from "./config";

const NAMES = [
	"nubis.config.ts",
	"nubis.config.mts",
	"nubis.config.js",
	"nubis.config.mjs",
];

export interface LoadedConfig {
	readonly config: NubisConfig;
	/** The file it came from; undefined when the bot has none. */
	readonly file: string | undefined;
	/** Where the bot's folders are: `root` resolved against the config's folder. */
	readonly root: string;
}

/** Loads `nubis.config.*` from `cwd`. A bot without one gets the defaults. */
export async function loadConfig(cwd: string): Promise<LoadedConfig> {
	for (const name of NAMES) {
		const file = join(cwd, name);
		const exists = await access(file).then(
			() => true,
			() => false,
		);
		if (!exists) continue;
		const url = pathToFileURL(file);
		// A fresh import each time, so `nubis dev` sees edits.
		url.searchParams.set("v", String(Date.now()));
		const module = (await import(url.href)) as { default?: unknown };
		const config = validateConfig(module.default, name);
		return { config, file, root: join(cwd, config.root ?? ".") };
	}
	return { config: {}, file: undefined, root: cwd };
}
