import { NubisError } from "./errors";

// Discord's custom_id limit.
const MAX_LENGTH = 100;
const SEPARATOR = "~";
const ID = /^[a-z0-9][a-z0-9_.-]{0,31}$/;

export function assertValidComponentId(id: string): void {
	if (!ID.test(id)) {
		throw new NubisError(
			`Component id "${id}" is invalid. Use 1-32 lowercase letters, digits, ".", "-" or "_", starting with a letter or digit.`,
		);
	}
}

/** `confirm-ban~{"userId":"42"}`: the id routes the interaction, the JSON is the state. */
export function encodeCustomId(id: string, state: unknown): string {
	const customId =
		state === undefined ? id : `${id}${SEPARATOR}${JSON.stringify(state)}`;
	if (customId.length > MAX_LENGTH) {
		throw new NubisError(
			`Component "${id}": its custom_id would be ${customId.length} characters, and Discord allows ${MAX_LENGTH}. Keep less in state: store large data yourself and put its key in state.`,
		);
	}
	return customId;
}

export type DecodedCustomId =
	| { readonly id: string; readonly ok: true; readonly state: unknown }
	| { readonly id: string; readonly ok: false };

export function decodeCustomId(customId: string): DecodedCustomId {
	const at = customId.indexOf(SEPARATOR);
	if (at === -1) return { id: customId, ok: true, state: undefined };

	const id = customId.slice(0, at);
	try {
		return { id, ok: true, state: JSON.parse(customId.slice(at + 1)) };
	} catch {
		return { id, ok: false };
	}
}
