import {
	type APIActionRowComponent,
	type APIAllowedMentions,
	type APIEmbed,
	type APIInteractionResponseCallbackData,
	type APIButtonComponent,
	type APIComponentInMessageActionRow,
	type APISelectMenuComponent,
	AllowedMentionsTypes,
	ComponentType,
} from "discord-api-types/v10";
import { NubisError } from "./errors";

export type ActionRow = APIActionRowComponent<APIComponentInMessageActionRow>;

/** A button or select menu, or a row you've laid out yourself. */
export type ComponentInput =
	APIButtonComponent | APISelectMenuComponent | ActionRow;

export interface ReplyOptions {
	readonly content?: string;
	/** Bare buttons are packed five to a row; each select menu gets its own row. */
	readonly components?: readonly ComponentInput[];
	readonly embeds?: readonly APIEmbed[];
	/**
	 * Only the person who used the command or component sees the reply.
	 * Defaults to the command's `ephemeral` setting.
	 */
	readonly ephemeral?: boolean;
	/**
	 * Who the message may ping. Nubis only pings mentioned users by default,
	 * never @everyone, @here or roles, so echoing user input can't mass-ping.
	 */
	readonly allowedMentions?: APIAllowedMentions;
}

export type ReplyInput = string | ReplyOptions;

/** A reply in the shape transports send to Discord. */
export interface ReplyMessage {
	readonly content: string | undefined;
	readonly components: readonly ActionRow[] | undefined;
	readonly embeds: readonly APIEmbed[] | undefined;
	/** `undefined` means "use the default for this interaction". */
	readonly ephemeral: boolean | undefined;
	readonly allowedMentions: APIAllowedMentions;
}

export const DEFAULT_ALLOWED_MENTIONS: APIAllowedMentions = {
	parse: [AllowedMentionsTypes.User],
};

// Discord's message flag for ephemeral messages.
const EPHEMERAL = 1 << 6;

/** The body Discord takes for responses, edits and follow-ups. */
export function toMessageBody(
	message: ReplyMessage,
	ephemeral: boolean,
): APIInteractionResponseCallbackData {
	return {
		...(message.content === undefined ? {} : { content: message.content }),
		...(message.components ? { components: [...message.components] } : {}),
		...(message.embeds ? { embeds: [...message.embeds] } : {}),
		allowed_mentions: message.allowedMentions,
		...(ephemeral ? { flags: EPHEMERAL } : {}),
	};
}

const BUTTONS_PER_ROW = 5;
const MAX_ROWS = 5;

export function toActionRows(
	components: readonly ComponentInput[],
): ActionRow[] {
	const rows: ActionRow[] = [];
	let buttons: APIButtonComponent[] = [];

	const flushButtons = () => {
		if (buttons.length > 0) {
			rows.push({ type: ComponentType.ActionRow, components: buttons });
			buttons = [];
		}
	};

	for (const component of components) {
		if (component.type === ComponentType.Button) {
			buttons.push(component);
			if (buttons.length === BUTTONS_PER_ROW) flushButtons();
			continue;
		}
		flushButtons();
		rows.push(
			component.type === ComponentType.ActionRow
				? component
				: { type: ComponentType.ActionRow, components: [component] },
		);
	}
	flushButtons();

	if (rows.length > MAX_ROWS) {
		throw new NubisError(
			`A message can have at most ${MAX_ROWS} rows of components (this one needs ${rows.length}).`,
		);
	}
	return rows;
}

export function toReplyMessage(input: ReplyInput): ReplyMessage {
	const options = typeof input === "string" ? { content: input } : input;
	return {
		content: options.content,
		components: options.components && toActionRows(options.components),
		embeds: options.embeds,
		ephemeral: options.ephemeral,
		allowedMentions: options.allowedMentions ?? DEFAULT_ALLOWED_MENTIONS,
	};
}
