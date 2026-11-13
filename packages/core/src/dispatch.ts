import {
	type APIApplicationCommandInteractionDataBasicOption,
	type APIApplicationCommandInteractionDataOption,
	type APIChatInputApplicationCommandInteraction,
	ApplicationCommandOptionType,
} from "discord-api-types/v10";
import { NubisError } from "./errors";
import {
	createLifecycle,
	type Lifecycle,
	type Scheduler,
	type Transport,
} from "./lifecycle";
import type { OptionMap, ResolvedOptions } from "./option";
import type { CommandLeaf, CommandTree } from "./tree";

export interface DispatchOptions {
	/** See LifecycleOptions.autoDeferMs. */
	readonly autoDeferMs?: number | false;
	readonly schedule?: Scheduler;
}

export type DispatchResult =
	| {
			readonly status: "handled";
			readonly path: readonly string[];
			/** False when the handler finished without answering; Discord shows "did not respond". */
			readonly responded: boolean;
	  }
	| { readonly status: "unknown"; readonly path: readonly string[] }
	| {
			readonly status: "error";
			readonly path: readonly string[];
			readonly error: unknown;
	  };

export const ERROR_MESSAGE = "Something went wrong. Please try again.";
export const UNKNOWN_COMMAND_MESSAGE =
	"This command isn't available anymore. Discord may still be catching up.";

/** Tells the user something broke, if the interaction can still be answered. */
export async function answerError(lifecycle: Lifecycle): Promise<void> {
	try {
		await lifecycle.reply({ content: ERROR_MESSAGE, ephemeral: true });
	} catch {
		// Answered with a modal, or Discord rejected the call: nothing more to say.
	}
}

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

/**
 * Routes a slash command interaction to the command that handles it, and
 * answers Discord on time: "thinking…" after two seconds of silence, follow-ups
 * for later replies, and an error message if the handler throws.
 */
export async function dispatch(
	tree: CommandTree,
	interaction: APIChatInputApplicationCommandInteraction,
	transport: Transport,
	options: DispatchOptions = {},
): Promise<DispatchResult> {
	const { leaf, path, options: given } = locate(tree, interaction);
	const lifecycle = createLifecycle(transport, {
		kind: "command",
		ephemeral: leaf?.definition.ephemeral,
		autoDeferMs: options.autoDeferMs,
		schedule: options.schedule,
	});

	if (leaf === undefined) {
		await lifecycle.reply({
			content: UNKNOWN_COMMAND_MESSAGE,
			ephemeral: true,
		});
		await lifecycle.finish();
		return { status: "unknown", path };
	}

	try {
		await leaf.definition.run({
			options: resolveOptions(leaf, given, interaction),
			interaction,
			reply: lifecycle.reply,
			editReply: lifecycle.editReply,
			defer: lifecycle.defer,
			showModal: lifecycle.showModal,
		});
	} catch (error) {
		await answerError(lifecycle);
		await lifecycle.finish();
		return { status: "error", path, error };
	}
	const { responded } = await lifecycle.finish();
	return { status: "handled", path, responded };
}
