import { API } from "@discordjs/core/http-only";
import { dispatchEvent, type ErrorHandler, type NubisApi } from "@nubisjs/core";
import { REST } from "@discordjs/rest";
import { WebSocketManager, WebSocketShardEvents } from "@discordjs/ws";
import {
	type APIInteraction,
	type GatewayDispatchPayload,
	type GatewayPresenceUpdateData,
	GatewayDispatchEvents,
} from "discord-api-types/v10";
import { intentsFor } from "./intents";
import type { Project } from "./loader";
import { type RestLike, restTransport } from "./rest-transport";
import { type RouteOptions, routeInteraction } from "./route";

/** What the bot needs from a gateway connection; @discordjs/ws by default. */
export interface GatewayLike {
	on(
		event: "dispatch",
		listener: (payload: GatewayDispatchPayload, shardId: number) => void,
	): unknown;
	connect(): Promise<void>;
	destroy(): Promise<void> | void;
}

export interface BotOptions {
	readonly token: string;
	readonly project: Project;
	/** Intents beyond what the project's events need, e.g. MessageContent. */
	readonly intents?: number;
	/** The status and activity shown when the bot connects. */
	readonly presence?: GatewayPresenceUpdateData;
	/** Guards, middleware and timing for every interaction. */
	readonly dispatch?: RouteOptions;
	/** Every handler error, from interactions and events. */
	readonly onError?: ErrorHandler;
	/** Swappable in tests. */
	readonly rest?: RestLike;
	readonly gateway?: (options: {
		intents: number;
		rest: RestLike;
		presence: GatewayPresenceUpdateData | null;
	}) => GatewayLike;
}

export interface Bot {
	/** Discord's REST API, authenticated as the bot. */
	readonly rest: RestLike;
	/** The typed API client handlers get as `api`. */
	readonly api: NubisApi;
	/** The intents the bot connects with. */
	readonly intents: number;
	start(): Promise<void>;
	stop(): Promise<void>;
}

/**
 * Connects a project to Discord's gateway: interactions go to their
 * dispatchers, every other event to the project's event handlers.
 */
export function createBot(options: BotOptions): Bot {
	const rest =
		options.rest ?? new REST({ version: "10" }).setToken(options.token);
	const intents = intentsFor(options.project.events, options.intents);
	const presence = options.presence ?? null;
	const gateway = options.gateway
		? options.gateway({ intents, rest, presence })
		: (new WebSocketManager({
				token: options.token,
				intents,
				rest: rest as REST,
				initialPresence: presence,
			}) as unknown as GatewayLike);
	const api = new API(rest as never) as NubisApi;
	const routeOptions: RouteOptions = {
		...options.dispatch,
		api,
		onError: options.onError ?? options.dispatch?.onError,
	};

	gateway.on(
		WebSocketShardEvents.Dispatch as "dispatch",
		(payload, shardId) => {
			if (payload.t === GatewayDispatchEvents.InteractionCreate) {
				const interaction = payload.d as APIInteraction;
				void routeInteraction(
					options.project,
					interaction,
					restTransport(rest, interaction),
					routeOptions,
				);
				return;
			}
			void dispatchEvent(options.project.events, payload.t, payload.d, {
				shardId,
				onError: routeOptions.onError,
				api,
			});
		},
	);

	return {
		rest,
		api,
		intents,
		start: () => gateway.connect(),
		stop: async () => {
			await gateway.destroy();
		},
	};
}
