import { NubisError } from "./errors";

/**
 * Keeps component state that won't fit in a custom_id (Discord allows 100
 * characters). The custom_id then carries only a key. Writes may be async;
 * Nubis waits for them before sending the message that holds the component.
 */
export interface StateStore {
	set(key: string, value: unknown): void | Promise<void>;
	/** `undefined` when the key is unknown or expired: the component is treated as stale. */
	get(key: string): unknown | Promise<unknown>;
}

export interface MemoryStoreOptions {
	/** How long state lives. Defaults to 24 hours. */
	readonly ttlMs?: number;
	/** Oldest entries are dropped past this. Defaults to 10,000. */
	readonly maxEntries?: number;
	/** Milliseconds since the epoch. Swappable in tests. */
	readonly now?: () => number;
}

/**
 * State in this process's memory. Fine for one process; it's lost on
 * restart, so use a shared store (Redis, a database) when running several.
 */
export function memoryStore(
	options: MemoryStoreOptions = {},
): StateStore & { readonly size: number } {
	const {
		ttlMs = 24 * 60 * 60 * 1000,
		maxEntries = 10_000,
		now = Date.now,
	} = options;
	const entries = new Map<string, { value: unknown; expires: number }>();
	return {
		get size() {
			return entries.size;
		},
		set(key, value) {
			entries.set(key, { value, expires: now() + ttlMs });
			// Maps keep insertion order, so the first keys are the oldest.
			while (entries.size > maxEntries) {
				const oldest = entries.keys().next().value;
				if (oldest === undefined) break;
				entries.delete(oldest);
			}
		},
		get(key) {
			const entry = entries.get(key);
			if (!entry) return undefined;
			if (entry.expires <= now()) {
				entries.delete(key);
				return undefined;
			}
			return entry.value;
		},
	};
}

// Core builds without DOM or Node types; Web Crypto is in every runtime Nubis targets.
declare const crypto: {
	getRandomValues<T extends Uint8Array>(array: T): T;
};

const ALPHABET =
	"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/** 16 random URL-safe characters (96 bits). */
export function newStateKey(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(16));
	let key = "";
	for (const byte of bytes) key += ALPHABET[byte % 64];
	return key;
}

const pending = new Set<Promise<void>>();
// Failures are kept until the next send reports them: a write can fail and
// leave `pending` before that send starts waiting.
const failures: unknown[] = [];

/** Records a store write so replies can wait for it. */
export function trackStateWrite(write: void | Promise<void>): void {
	if (!(write instanceof Promise)) return;
	const tracked: Promise<void> = write.then(
		() => {
			pending.delete(tracked);
		},
		(error: unknown) => {
			pending.delete(tracked);
			failures.push(error);
		},
	);
	pending.add(tracked);
}

/**
 * Waits for state writes started so far. Called before every message is sent,
 * so a component's state is saved before anyone can click it. A failed write
 * fails the send rather than delivering a component whose state is gone.
 */
export async function settleStateWrites(): Promise<void> {
	if (pending.size > 0) await Promise.all([...pending]);
	if (failures.length > 0) {
		const [first] = failures.splice(0);
		throw new NubisError(`Saving component state failed: ${String(first)}`);
	}
}
