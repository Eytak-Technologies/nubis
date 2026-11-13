import type { APIChatInputApplicationCommandInteraction } from "discord-api-types/v10";
import type { OptionMap, ResolvedOptions } from "./option";
import type { ReplyInput } from "./reply";

export interface CommandContext<T extends OptionMap> {
	readonly options: ResolvedOptions<T>;
	/** The raw interaction from Discord, for anything Nubis doesn't cover yet. */
	readonly interaction: APIChatInputApplicationCommandInteraction;
	reply(message: ReplyInput): Promise<void>;
}

export interface CommandConfig<T extends OptionMap> {
	readonly description: string;
	readonly options?: T;
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
