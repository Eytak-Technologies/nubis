import { readdir, stat } from "node:fs/promises";
import { extname, join, relative, sep } from "node:path";
import { pathToFileURL } from "node:url";
import {
	type AnyEventDefinition,
	buildCommandTree,
	type CommandDefinition,
	type CommandFile,
	type CommandFolder,
	type CommandTree,
	type ComponentDefinition,
	type ComponentRegistry,
	createComponentRegistry,
	createEventRegistry,
	type EventRegistry,
	type MenuDefinition,
	NubisError,
	type OptionMap,
} from "@nubisjs/core";

/** Everything a bot is made of, read from its folders. */
export interface Project {
	readonly root: string;
	readonly tree: CommandTree;
	readonly components: ComponentRegistry;
	readonly menus: readonly MenuDefinition[];
	readonly events: EventRegistry;
	/** Every module that was loaded, relative to `root`, for watching and messages. */
	readonly files: readonly string[];
}

export interface LoadOptions {
	/** File extensions to load. Defaults to .ts, .mts, .js and .mjs. */
	readonly extensions?: readonly string[];
	/**
	 * Appended to import URLs so a changed file is imported fresh, for hot
	 * reload. Leave it out to use the module cache.
	 */
	readonly version?: string | number;
}

const DEFAULT_EXTENSIONS = [".ts", ".mts", ".js", ".mjs"];
const FOLDER_FILE = "_folder";

type Module = Record<string, unknown>;

/** Lists module files under `dir`, sorted, skipping tests, type declarations and `_` files. */
async function listModules(
	dir: string,
	extensions: readonly string[],
): Promise<string[]> {
	let names: string[];
	try {
		names = await readdir(dir);
	} catch (error) {
		if ((error as { code?: string }).code === "ENOENT") return [];
		throw error;
	}
	const files: string[] = [];
	for (const name of names.sort()) {
		const path = join(dir, name);
		if ((await stat(path)).isDirectory()) {
			files.push(...(await listModules(path, extensions)));
			continue;
		}
		const base = name.slice(0, name.length - extname(name).length);
		if (!extensions.includes(extname(name))) continue;
		if (name.endsWith(".d.ts") || /\.(test|spec)$/.test(base)) continue;
		if (base.startsWith("_") && base !== FOLDER_FILE) continue;
		files.push(path);
	}
	return files;
}

async function importModule(
	file: string,
	root: string,
	version: string | number | undefined,
): Promise<Module> {
	const url = pathToFileURL(file);
	if (version !== undefined) url.searchParams.set("v", String(version));
	try {
		return (await import(url.href)) as Module;
	} catch (error) {
		const code = (error as { code?: string }).code;
		if (code === "ERR_UNKNOWN_FILE_EXTENSION") {
			throw new NubisError(
				`${relative(root, file)}: this runtime can't import ${extname(file)} files. Run the bot with Bun or Node 22.18+, or build it to JavaScript first.`,
			);
		}
		throw error;
	}
}

const isObject = (value: unknown): value is Record<string, unknown> =>
	(typeof value === "object" || typeof value === "function") && value !== null;

const isCommand = (value: unknown): value is CommandDefinition<OptionMap> =>
	isObject(value) && value.kind === "command";

const isComponent = (value: unknown): value is ComponentDefinition =>
	isObject(value) && "~nubis" in value;

const isMenu = (value: unknown): value is MenuDefinition =>
	isObject(value) &&
	(value.kind === "user" || value.kind === "message") &&
	"config" in value;

const isEvent = (value: unknown): value is AnyEventDefinition =>
	isObject(value) && value.kind === "event";

const segmentsOf = (file: string, dir: string) => {
	const path = relative(dir, file);
	return path.slice(0, path.length - extname(path).length).split(sep);
};

/**
 * Loads a bot from its folders:
 *
 * - `commands/` — one command per file, `export default command(...)`.
 *   Folders become subcommands; `_folder.ts` sets a folder's description,
 *   guards and permissions.
 * - `components/` — buttons, selects and modals; every export that is one.
 * - `menus/` — right-click commands, `export default userCommand(...)`.
 * - `events/` — `export default event(...)`, or an array of them.
 *
 * Files starting with `_`, tests and `.d.ts` files are skipped.
 */
export async function loadProject(
	root: string,
	options: LoadOptions = {},
): Promise<Project> {
	const extensions = options.extensions ?? DEFAULT_EXTENSIONS;
	const load = (file: string) => importModule(file, root, options.version);
	const where = (file: string) => relative(root, file);
	const files: string[] = [];

	// commands/
	const commandsDir = join(root, "commands");
	const commandFiles: CommandFile[] = [];
	const folders: CommandFolder[] = [];
	for (const file of await listModules(commandsDir, extensions)) {
		files.push(where(file));
		const module = await load(file);
		const segments = segmentsOf(file, commandsDir);
		if (segments.at(-1) === FOLDER_FILE) {
			const settings = module.default;
			if (!isObject(settings)) {
				throw new NubisError(
					`${where(file)}: export the folder's settings as default, e.g. export default folder({ description: "..." }).`,
				);
			}
			folders.push({ ...settings, path: segments.slice(0, -1) });
			continue;
		}
		if (!isCommand(module.default)) {
			throw new NubisError(
				`${where(file)}: export a command as default, e.g. export default command({ ... }). Helpers that aren't commands can live in files starting with "_".`,
			);
		}
		commandFiles.push({ path: segments, definition: module.default });
	}

	// components/
	const components: ComponentDefinition[] = [];
	for (const file of await listModules(join(root, "components"), extensions)) {
		files.push(where(file));
		const found = Object.values(await load(file)).filter(isComponent);
		if (found.length === 0) {
			throw new NubisError(
				`${where(file)}: no buttons, selects or modals are exported here.`,
			);
		}
		// The same definition can be exported twice (named and default).
		for (const component of found) {
			if (!components.includes(component)) components.push(component);
		}
	}

	// menus/
	const menus: MenuDefinition[] = [];
	for (const file of await listModules(join(root, "menus"), extensions)) {
		files.push(where(file));
		const menu = (await load(file)).default;
		if (!isMenu(menu)) {
			throw new NubisError(
				`${where(file)}: export a context menu command as default, e.g. export default userCommand({ ... }).`,
			);
		}
		menus.push(menu);
	}

	// events/
	const events: AnyEventDefinition[] = [];
	for (const file of await listModules(join(root, "events"), extensions)) {
		files.push(where(file));
		const exported = (await load(file)).default;
		const list = Array.isArray(exported) ? exported : [exported];
		if (list.length === 0 || !list.every(isEvent)) {
			throw new NubisError(
				`${where(file)}: export an event as default, e.g. export default event("guildMemberAdd", ...), or an array of them.`,
			);
		}
		events.push(...list);
	}

	return {
		root,
		tree: buildCommandTree(commandFiles, folders),
		components: createComponentRegistry(components),
		menus,
		events: createEventRegistry(events),
		files,
	};
}
