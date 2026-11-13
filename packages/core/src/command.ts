import type { APIChatInputApplicationCommandInteraction } from "discord-api-types/v10";
import type { ModalData } from "./component";
import type { Guard } from "./guard";
import type { Middleware } from "./middleware";
import type { OptionMap, ResolvedOptions } from "./option";
import type { ReplyInput } from "./reply";

/** Where a command can be used: servers, the bot's DMs, or group DMs and other users' DMs. */
export type CommandContextName = "guild" | "bot-dm" | "private-channel";
/** How the app is installed: to a server, or to a user's account. */
export type IntegrationTypeName = "guild" | "user";

/** Settings Discord only reads on top-level commands; folders can set them too. */
export interface TopLevelSettings {
	readonly defaultMemberPermissions?: readonly bigint[];
	readonly contexts?: readonly CommandContextName[];
	readonly integrationTypes?: readonly IntegrationTypeName[];
	readonly nsfw?: boolean;
}

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
	/** Checks that run before `run`, after the folder's and the bot's own. */
	readonly guards?: readonly Guard[];
	/** Wraps `run`, inside the folder's and the bot's own middleware. */
	readonly middleware?: readonly Middleware[];
	/**
	 * Hides the command from members without these permissions
	 * (`PermissionFlagsBits`). Server admins can change this in Discord's
	 * settings, so pair it with a `hasPermission` guard when it matters.
	 * Top-level commands only; for subcommands, set it on the folder.
	 */
	readonly defaultMemberPermissions?: readonly bigint[];
	/** Top-level only. Where the command can be used. Defaults to everywhere it's installed. */
	readonly contexts?: readonly CommandContextName[];
	/** Top-level only. "user" makes it usable when installed to a user's account. */
	readonly integrationTypes?: readonly IntegrationTypeName[];
	/** Top-level only. Age-restricted: only shown in age-restricted channels. */
	readonly nsfw?: boolean;
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
