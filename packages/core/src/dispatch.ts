import {
	type APIApplicationCommandInteractionDataBasicOption,
	type APIApplicationCommandInteractionDataOption,
	type APIChatInputApplicationCommandInteraction,
	ApplicationCommandOptionType,
} from "discord-api-types/v10";
import { NubisError } from "./errors";
import type { OptionMap, ResolvedOptions } from "./option";
import { type ReplyMessage, toReplyMessage } from "./reply";
import type { CommandLeaf, CommandTree } from "./tree";

/** How handlers answer. The gateway and HTTP transports each provide one. */
export interface Responder {
	reply(message: ReplyMessage): Promise<void>;
	/** Edits the message a component is on. Only valid for component interactions. */
	update(message: ReplyMessage): Promise<void>;
}

export type DispatchResult =
	| { readonly status: "handled"; readonly path: readonly string[] }
	| { readonly status: "unknown"; readonly path: readonly string[] };

interface Located {
	readonly leaf: CommandLeaf | undefined;
	readonly path: readonly string[];
	readonly options: readonly APIApplicationCommandInteractionDataBasicOption[];
}

function locate(
	tree: CommandTree,
	interaction: APIChatInputApplicationCommandInteraction,
): Located {
	const path = [interaction.data.name];
	let node = tree.get(interaction.data.name);
	let options: readonly APIApplicationCommandInteractionDataOption[] =
		interaction.data.options ?? [];

	while (node?.type === "parent") {
		const [next] = options;
		if (
			next?.type !== ApplicationCommandOptionType.Subcommand &&
			next?.type !== ApplicationCommandOptionType.SubcommandGroup
		) {
			return { leaf: undefined, path, options: [] };
		}
		path.push(next.name);
		node = node.children.get(next.name);
		options = next.options ?? [];
	}

	return {
		leaf: node,
		path,
		options:
			options as readonly APIApplicationCommandInteractionDataBasicOption[],
	};
}

function resolveOptions(
	leaf: CommandLeaf,
	given: readonly APIApplicationCommandInteractionDataBasicOption[],
	interaction: APIChatInputApplicationCommandInteraction,
): ResolvedOptions<OptionMap> {
	const resolved = interaction.data.resolved;
	const values: Record<string, unknown> = {};

	for (const [name, definition] of Object.entries(leaf.definition.options)) {
		const option = given.find((candidate) => candidate.name === name);
		if (option === undefined) {
			if (definition.required) {
				throw new NubisError(
					`/${leaf.path.join(" ")}: Discord sent no value for required option "${name}". Commands may be out of sync; run nubis sync.`,
				);
			}
			values[name] = undefined;
			continue;
		}

		const id = String(option.value);
		const lookup = {
			user: () => resolved?.users?.[id],
			role: () => resolved?.roles?.[id],
			channel: () => resolved?.channels?.[id],
		} as const;
		const kind = definition.kind;
		values[name] =
			kind === "user" || kind === "role" || kind === "channel"
				? lookup[kind]()
				: option.value;

		if (values[name] === undefined) {
			throw new NubisError(
				`/${leaf.path.join(" ")}: Discord didn't include the ${kind} for option "${name}".`,
			);
		}
	}

	return values as ResolvedOptions<OptionMap>;
}

/** Routes a slash command interaction to the command that handles it. */
export async function dispatch(
	tree: CommandTree,
	interaction: APIChatInputApplicationCommandInteraction,
	responder: Responder,
): Promise<DispatchResult> {
	const { leaf, path, options } = locate(tree, interaction);
	if (leaf === undefined) return { status: "unknown", path };

	await leaf.definition.run({
		options: resolveOptions(leaf, options, interaction),
		interaction,
		reply: (message) => responder.reply(toReplyMessage(message)),
	});
	return { status: "handled", path };
}
