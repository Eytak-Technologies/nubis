import type { APIChatInputApplicationCommandInteraction } from "discord-api-types/v10";
import type { ModalData } from "./component";
import type { OptionMap, ResolvedOptions } from "./option";
import type { ReplyInput } from "./reply";

export interface CommandContext<T extends OptionMap> {
	readonly options: ResolvedOptions<T>;
	/** The raw interaction from Discord, for anything Nubis doesn't cover yet. */
	readonly interaction: APIChatInputApplicationCommandInteraction;
	/** Sends a message. The first one answers the command, later ones are follow-ups. */
	reply(message: ReplyInput): Promise<void>;
	/** Edits the first reply, e.g. to show progress. */
	editReply(message: ReplyInput): Promise<void>;
	/**
	 * Shows "thinking…" for work over three seconds. Nubis does this on its
	 * own after two seconds; call it earlier to choose `ephemeral` yourself.
	 */
	defer(options?: { readonly ephemeral?: boolean }): Promise<void>;
	/** Opens a modal. Must be the first response, so call it before reply(). */
	showModal(modal: ModalData): Promise<void>;
}

export interface CommandConfig<T extends OptionMap> {
	readonly description: string;
	readonly options?: T;
	/** Makes replies (and the automatic "thinking…") visible only to the user. */
	readonly ephemeral?: boolean;
	run(context: CommandContext<T>): unknown;
}

export interface CommandDefinition<
	T extends OptionMap,
> extends CommandConfig<T> {
	readonly kind: "command";
	readonly options: T;
}

export function command<T extends OptionMap = Record<never, never>>(
	config: CommandConfig<T>,
): CommandDefinition<T> {
	return {
		...config,
		kind: "command",
		options: config.options ?? ({} as T),
	};
}
