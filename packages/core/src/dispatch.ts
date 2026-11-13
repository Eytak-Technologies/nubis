import {
	type APIApplicationCommandInteractionDataBasicOption,
	type APIApplicationCommandInteractionDataOption,
	type APIChatInputApplicationCommandInteraction,
	ApplicationCommandOptionType,
} from "discord-api-types/v10";
import type { NubisApi } from "./api";
import { type ErrorHandler, NubisError, reportError } from "./errors";
import { type Guard, guardContext, runGuards } from "./guard";
import { type Middleware, runWithMiddleware } from "./middleware";
import {
	createLifecycle,
	type Lifecycle,
	type Scheduler,
	type Transport,
} from "./lifecycle";
import type { OptionMap, ResolvedOptions } from "./option";
import type { CommandLeaf, CommandParent, CommandTree } from "./tree";

export interface DispatchOptions {
	/** See LifecycleOptions.autoDeferMs. */
	readonly autoDeferMs?: number | false;
	readonly schedule?: Scheduler;
	/** Run before every handler, before folder and command guards. */
	readonly guards?: readonly Guard[];
	/** Wraps every handler, outermost. */
	readonly middleware?: readonly Middleware[];
	/** Receives every error a handler throws, after the user is told. */
	readonly onError?: ErrorHandler;
	/** Discord's API client, handed to handlers as `api`. */
	readonly api?: NubisApi;
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
			readonly status: "denied";
			readonly path: readonly string[];
			readonly message: string;
	  }
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

export interface Located {
	readonly leaf: CommandLeaf | undefined;
	/** Folders on the way to the leaf, outermost first. */
	readonly parents: readonly CommandParent[];
	readonly path: readonly string[];
	readonly options: readonly APIApplicationCommandInteractionDataBasicOption[];
}

/** Finds the command an interaction's data points at, through subcommands and groups. */
export function locate(
	tree: CommandTree,
	data: {
		readonly name: string;
		readonly options?: readonly APIApplicationCommandInteractionDataOption[];
	},
): Located {
	const path = [data.name];
	const parents: CommandParent[] = [];
	let node = tree.get(data.name);
	let options: readonly APIApplicationCommandInteractionDataOption[] =
		data.options ?? [];

	while (node?.type === "parent") {
		parents.push(node);
		const [next] = options;
		if (
			next?.type !== ApplicationCommandOptionType.Subcommand &&
			next?.type !== ApplicationCommandOptionType.SubcommandGroup
		) {
			return { leaf: undefined, parents, path, options: [] };
		}
		path.push(next.name);
		node = node.children.get(next.name);
		options = next.options ?? [];
	}

	return {
		leaf: node,
		parents,
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
	const {
		leaf,
		parents,
		path,
		options: given,
	} = locate(tree, interaction.data);
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
		const context = guardContext(interaction, options.api);
		const denial = await runGuards(
			[
				...(options.guards ?? []),
				...parents.flatMap((parent) => parent.folder?.guards ?? []),
				...(leaf.definition.guards ?? []),
			],
			context,
		);
		if (denial) {
			await lifecycle.reply({ content: denial.message, ephemeral: true });
			await lifecycle.finish();
			return { status: "denied", path, message: denial.message };
		}

		const { deny: _deny, ...base } = context;
		await runWithMiddleware(
			[
				...(options.middleware ?? []),
				...parents.flatMap((parent) => parent.folder?.middleware ?? []),
				...(leaf.definition.middleware ?? []),
			],
			{ ...base, name: `/${path.join(" ")}`, kind: "command" },
			async () => {
				await leaf.definition.run({
					options: resolveOptions(leaf, given, interaction),
					interaction,
					api: context.api,
					reply: lifecycle.reply,
					editReply: lifecycle.editReply,
					defer: lifecycle.defer,
					showModal: lifecycle.showModal,
				});
			},
		);
	} catch (error) {
		await answerError(lifecycle);
		await lifecycle.finish();
		reportError(options.onError, error, {
			kind: "command",
			name: `/${path.join(" ")}`,
			interaction,
		});
		return { status: "error", path, error };
	}
	const { responded } = await lifecycle.finish();
	return { status: "handled", path, responded };
}
