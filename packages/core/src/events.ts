import type { GatewayDispatchPayload } from "discord-api-types/v10";
import { missingApi, type NubisApi } from "./api";
import { type ErrorHandler, reportError } from "./errors";

type DispatchData = { [P in GatewayDispatchPayload as P["t"]]: P["d"] };

type PascalTail<S extends string> = S extends `${infer Head}_${infer Rest}`
	? `${Capitalize<Lowercase<Head>>}${PascalTail<Rest>}`
	: Capitalize<Lowercase<S>>;

/** "GUILD_MEMBER_ADD" → "guildMemberAdd". */
export type CamelCase<S extends string> =
	S extends `${infer Head}_${infer Rest}`
		? `${Lowercase<Head>}${PascalTail<Rest>}`
		: Lowercase<S>;

/** Gateway events by their Nubis name, with Discord's payload for each. */
export type EventPayloads = {
	[K in keyof DispatchData as CamelCase<K & string>]: DispatchData[K];
};

export type EventName = keyof EventPayloads;

export interface EventContext {
	readonly name: EventName;
	/** The shard that received the event, when the transport shards. */
	readonly shardId: number | undefined;
	/** Discord's API, to act on the event. */
	readonly api: NubisApi;
}

export interface EventDefinition<N extends EventName = EventName> {
	readonly kind: "event";
	readonly name: N;
	readonly handler: (data: EventPayloads[N], context: EventContext) => unknown;
}

/** Discord's event name in Nubis form, the same conversion the types do. */
export function toEventName(type: string): string {
	return type
		.toLowerCase()
		.replace(/_([a-z0-9])/g, (_, letter: string) => letter.toUpperCase());
}

/**
 * Runs `handler` for a gateway event, with Discord's payload typed:
 *
 *     event("guildMemberAdd", (member) => member.user.username)
 */
export function event<N extends EventName>(
	name: N,
	handler: (data: EventPayloads[N], context: EventContext) => unknown,
): EventDefinition<N> {
	return { kind: "event", name, handler };
}

/** Any one event's definition. A union, so each keeps its own payload type. */
export type AnyEventDefinition = {
	[N in EventName]: EventDefinition<N>;
}[EventName];

export type EventRegistry = ReadonlyMap<string, readonly AnyEventDefinition[]>;

/** Groups handlers by event. Several handlers can listen to the same event. */
export function createEventRegistry(
	events: readonly AnyEventDefinition[],
): EventRegistry {
	const registry = new Map<string, AnyEventDefinition[]>();
	for (const definition of events) {
		const list = registry.get(definition.name) ?? [];
		list.push(definition);
		registry.set(definition.name, list);
	}
	return registry;
}

export interface EventDispatchResult {
	readonly name: string;
	/** How many handlers ran to completion. */
	readonly handled: number;
	readonly errors: readonly unknown[];
}

/**
 * Runs every handler for a gateway dispatch (`t` and `d` as Discord sends
 * them). Handlers run concurrently; one throwing doesn't stop the others.
 */
export async function dispatchEvent(
	registry: EventRegistry,
	type: string,
	data: unknown,
	options: {
		readonly shardId?: number;
		readonly onError?: ErrorHandler;
		readonly api?: NubisApi;
	} = {},
): Promise<EventDispatchResult> {
	const name = toEventName(type);
	const handlers = registry.get(name) ?? [];
	const context: EventContext = {
		name: name as EventName,
		shardId: options.shardId,
		api: options.api ?? missingApi(),
	};
	const results = await Promise.allSettled(
		handlers.map(async (definition) =>
			(definition.handler as (data: unknown, context: EventContext) => unknown)(
				data,
				context,
			),
		),
	);
	const errors = results.flatMap((result) =>
		result.status === "rejected" ? [result.reason] : [],
	);
	for (const error of errors) {
		reportError(options.onError, error, { kind: "event", name });
	}
	return { name, handled: results.length - errors.length, errors };
}
