import { NubisError } from "./errors";
import { newStateKey, type StateStore, trackStateWrite } from "./store";

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
			`Component "${id}": its custom_id would be ${customId.length} characters, and Discord allows ${MAX_LENGTH}. Keep less in state, or give the component a \`store\` to keep state outside the custom_id.`,
		);
	}
	return customId;
}

/** `confirm-ban~$Kq3…`: the state lives in a StateStore under that key. */
export function encodeStoredCustomId(id: string, key: string): string {
	return `${id}${SEPARATOR}$${key}`;
}

/**
 * The custom_id for a render: state inline as JSON, or with a store, saved
 * under a fresh key. The write is tracked so replies wait for it.
 */
export function renderCustomId(
	id: string,
	state: unknown,
	store: StateStore | undefined,
): string {
	if (!store || state === undefined) return encodeCustomId(id, state);
	const key = newStateKey();
	trackStateWrite(store.set(key, state));
	return encodeStoredCustomId(id, key);
}

export type DecodedCustomId =
	| { readonly id: string; readonly ok: true; readonly state: unknown }
	/** State is in a store under `key`. JSON never starts with "$", so this can't be mistaken for inline state. */
	| { readonly id: string; readonly ok: true; readonly key: string }
	| { readonly id: string; readonly ok: false };

export function decodeCustomId(customId: string): DecodedCustomId {
	const at = customId.indexOf(SEPARATOR);
	if (at === -1) return { id: customId, ok: true, state: undefined };

	const id = customId.slice(0, at);
	const rest = customId.slice(at + 1);
	if (rest.startsWith("$")) return { id, ok: true, key: rest.slice(1) };
	try {
		return { id, ok: true, state: JSON.parse(rest) };
	} catch {
		return { id, ok: false };
	}
}
