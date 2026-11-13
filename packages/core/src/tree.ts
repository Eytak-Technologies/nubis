import type { CommandDefinition } from "./command";
import { NubisError } from "./errors";
import type { Guard } from "./guard";
import type { Middleware } from "./middleware";
import { assertValidName } from "./names";
import type { OptionMap } from "./option";

/** A command module found on disk: `commands/config/set.ts` has path `["config", "set"]`. */
export interface CommandFile {
	readonly path: readonly string[];
	readonly definition: CommandDefinition<OptionMap>;
}

export interface CommandLeaf {
	readonly type: "command";
	readonly name: string;
	readonly path: readonly string[];
	readonly definition: CommandDefinition<OptionMap>;
}

/**
 * Settings for a folder of commands (the loader will read them from a file in
 * the folder). Guards and middleware apply to every command inside it.
 */
export interface CommandFolder {
	readonly path: readonly string[];
	/** Shown in Discord's command picker. Defaults to the folder name. */
	readonly description?: string;
	readonly guards?: readonly Guard[];
	readonly middleware?: readonly Middleware[];
	/** Top-level folders only: see CommandConfig.defaultMemberPermissions. */
	readonly defaultMemberPermissions?: readonly bigint[];
}

export interface CommandParent {
	readonly type: "parent";
	readonly name: string;
	readonly path: readonly string[];
	readonly children: ReadonlyMap<string, CommandNode>;
	readonly folder: CommandFolder | undefined;
}

export type CommandNode = CommandLeaf | CommandParent;

/** Top-level command name → node. */
export type CommandTree = ReadonlyMap<string, CommandNode>;

// Discord allows /command, /command subcommand and /command group subcommand.
const MAX_DEPTH = 3;

const slash = (path: readonly string[]) => `/${path.join(" ")}`;

/**
 * Turns command files into the shape Discord expects. A folder becomes a
 * command with subcommands, a nested folder a subcommand group.
 */
export function buildCommandTree(
	files: readonly CommandFile[],
	folders: readonly CommandFolder[] = [],
): CommandTree {
	const root = new Map<string, CommandNode>();

	for (const file of files) {
		const where = `commands/${file.path.join("/")}`;
		if (file.path.length === 0) {
			throw new NubisError("A command file must have a name.");
		}
		if (file.path.length > MAX_DEPTH) {
			throw new NubisError(
				`${where}: commands can be nested at most ${MAX_DEPTH} levels deep (/command group subcommand).`,
			);
		}
		for (const segment of file.path) assertValidName(segment, where);

		let level = root;
		file.path.forEach((segment, index) => {
			const path = file.path.slice(0, index + 1);
			const existing = level.get(segment);
			const isLast = index === file.path.length - 1;

			if (isLast) {
				if (existing) {
					throw new NubisError(
						existing.type === "command"
							? `${slash(path)} is defined twice.`
							: `${where}: ${slash(path)} has subcommands, so it can't also be a command. Discord doesn't allow running a command that has subcommands.`,
					);
				}
				level.set(segment, {
					type: "command",
					name: segment,
					path,
					definition: file.definition,
				});
				return;
			}

			if (existing?.type === "command") {
				throw new NubisError(
					`${where}: ${slash(path)} is a command, so it can't also have subcommands. Discord doesn't allow running a command that has subcommands.`,
				);
			}
			const parent: CommandParent = existing ?? {
				type: "parent",
				name: segment,
				path,
				children: new Map(),
				folder: undefined,
			};
			level.set(segment, parent);
			level = parent.children as Map<string, CommandNode>;
		});
	}

	for (const folder of folders) {
		const where = `commands/${folder.path.join("/")}`;
		let level: ReadonlyMap<string, CommandNode> = root;
		let node: CommandNode | undefined;
		for (const segment of folder.path) {
			node = level.get(segment);
			if (node?.type !== "parent") break;
			level = node.children;
		}
		if (node?.type !== "parent" || node.path.length !== folder.path.length) {
			throw new NubisError(
				`${where}: folder settings need a folder with commands in it, and there is none.`,
			);
		}
		if (node.folder)
			throw new NubisError(`${where}: folder settings are defined twice.`);
		(node as { folder: CommandFolder | undefined }).folder = folder;
	}

	return root;
}
