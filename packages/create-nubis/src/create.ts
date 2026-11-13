import { mkdir, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { type PackageManager, templateFiles } from "./templates";

export interface CreateOptions {
	readonly name: string;
	readonly packageManager: PackageManager;
	readonly nubisVersion: string;
}

/** Writes a new bot into `dir`, which must be missing or empty. Returns the files written. */
export async function createProject(
	dir: string,
	options: CreateOptions,
): Promise<string[]> {
	const existing = await readdir(dir).catch(() => [] as string[]);
	if (existing.length > 0) {
		throw new Error(
			`${dir} isn't empty. Pick a new folder name, or empty this one first.`,
		);
	}
	const files = templateFiles(options);
	for (const [path, content] of Object.entries(files)) {
		await mkdir(dirname(join(dir, path)), { recursive: true });
		await writeFile(join(dir, path), content);
	}
	return Object.keys(files);
}

/** The package manager that ran create-nubis (npx, bunx, pnpm create…), from npm_config_user_agent. */
export function detectPackageManager(
	userAgent: string | undefined,
): PackageManager {
	const name = userAgent?.split("/")[0];
	return name === "bun" || name === "pnpm" || name === "yarn" ? name : "npm";
}

/** `^0.1.0` for released versions; "latest" while developing (0.0.0). */
export function nubisRange(version: string): string {
	return version === "0.0.0" ? "latest" : `^${version}`;
}
