import {
	type APIActionRowComponent,
	type APIButtonComponent,
	type APIComponentInMessageActionRow,
	type APISelectMenuComponent,
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
	/** Only the person who used the command or component sees the reply. */
	readonly ephemeral?: boolean;
}

export type ReplyInput = string | ReplyOptions;

/** A reply in the shape transports send to Discord. */
export interface ReplyMessage {
	readonly content: string | undefined;
	readonly components: readonly ActionRow[] | undefined;
	readonly ephemeral: boolean;
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
		ephemeral: options.ephemeral ?? false,
	};
}
