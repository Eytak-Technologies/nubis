import {
	type APIApplicationCommandInteractionDataOption,
	type APIChatInputApplicationCommandInteraction,
	type APIInteractionDataResolved,
	type APIMessageComponentInteraction,
	type APIModalSubmitInteraction,
	ComponentType,
	type APIInteractionResponse,
	type APIInteractionResponseCallbackData,
	type APIModalInteractionResponseCallbackData,
	ApplicationCommandType,
	InteractionResponseType,
	InteractionType,
} from "discord-api-types/v10";
import type { Scheduler, Transport } from "../lifecycle";

/** A button click or string select, as Discord sends it. */
export function componentInteraction(
	customId: string,
	component:
		| { type: ComponentType.Button }
		| { type: ComponentType.StringSelect; values: string[] },
	actor?: Actor,
): APIMessageComponentInteraction {
	return {
		...actorFields(actor),
		id: "1",
		application_id: "2",
		type: InteractionType.MessageComponent,
		token: "test-token",
		version: 1,
		data: {
			custom_id: customId,
			component_type: component.type,
			...("values" in component ? { values: component.values } : {}),
		},
	} as unknown as APIMessageComponentInteraction;
}

/** Who's interacting: a DM user by default, or a server member. */
export interface Actor {
	readonly userId?: string;
	readonly guildId?: string;
	readonly roles?: string[];
	/** Permission bits, as Discord sends them on members. */
	readonly permissions?: bigint;
	/** The bot's own permissions in the channel. */
	readonly appPermissions?: bigint;
	readonly channelId?: string;
	/** For components: who ran the command that sent the message. */
	readonly invokerId?: string;
}

export function actorFields(actor: Actor = {}) {
	const user = {
		id: actor.userId ?? "u1",
		username: "tester",
		discriminator: "0",
	};
	return {
		channel_id: actor.channelId ?? "c1",
		app_permissions: String(actor.appPermissions ?? 0n),
		...(actor.guildId
			? {
					guild_id: actor.guildId,
					member: {
						user,
						roles: actor.roles ?? [],
						permissions: String(actor.permissions ?? 0n),
					},
				}
			: { user }),
		...(actor.invokerId
			? {
					message: {
						id: "m1",
						interaction_metadata: {
							id: "i0",
							type: 2,
							user: { id: actor.invokerId },
						},
					},
				}
			: {}),
	};
}

/** A minimal slash command interaction, enough for routing and option tests. */
export function chatInput(
	name: string,
	options?: APIApplicationCommandInteractionDataOption[],
	resolved?: APIInteractionDataResolved,
	actor?: Actor,
): APIChatInputApplicationCommandInteraction {
	return {
		...actorFields(actor),
		id: "1",
		application_id: "2",
		type: InteractionType.ApplicationCommand,
		token: "test-token",
		version: 1,
		data: {
			id: "3",
			type: ApplicationCommandType.ChatInput,
			name,
			...(options ? { options } : {}),
			...(resolved ? { resolved } : {}),
		},
	} as unknown as APIChatInputApplicationCommandInteraction;
}

export type TransportCall =
	| { readonly type: "respond"; readonly response: APIInteractionResponse }
	| {
			readonly type: "editOriginal";
			readonly body: APIInteractionResponseCallbackData;
	  }
	| { readonly type: "deleteOriginal" }
	| {
			readonly type: "followUp";
			readonly body: APIInteractionResponseCallbackData;
	  };

/**
 * A transport that records what would have been sent to Discord. The arrays
 * are live (filled as calls happen), so they can be destructured up front.
 */
export function recorder() {
	const calls: TransportCall[] = [];
	/** Text of every message sent, edited or followed up, in order. */
	const replies: string[] = [];
	const modals: APIModalInteractionResponseCallbackData[] = [];
	/** Call types in order, e.g. ["respond:5", "editOriginal"]. */
	const trace: string[] = [];

	const record = (call: TransportCall) => {
		calls.push(call);
		trace.push(
			call.type === "respond" ? `respond:${call.response.type}` : call.type,
		);
		if (call.type === "editOriginal" || call.type === "followUp") {
			replies.push(call.body.content ?? "");
		} else if (call.type === "respond") {
			const { response } = call;
			if (
				response.type === InteractionResponseType.ChannelMessageWithSource ||
				response.type === InteractionResponseType.UpdateMessage
			) {
				replies.push(response.data?.content ?? "");
			} else if (response.type === InteractionResponseType.Modal) {
				modals.push(response.data);
			}
		}
	};

	const transport: Transport = {
		respond: async (response) => record({ type: "respond", response }),
		editOriginal: async (body) => record({ type: "editOriginal", body }),
		deleteOriginal: async () => record({ type: "deleteOriginal" }),
		followUp: async (body) => record({ type: "followUp", body }),
	};
	return { calls, replies, modals, trace, transport };
}

/** A scheduler driven by hand, so auto-defer tests don't wait on real time. */
export function manualClock() {
	const pending: { run: () => void; ms: number; cancelled: boolean }[] = [];
	return {
		schedule: ((run, ms) => {
			const timer = { run, ms, cancelled: false };
			pending.push(timer);
			return () => {
				timer.cancelled = true;
			};
		}) satisfies Scheduler,
		/** Fires every timer that hasn't been cancelled. */
		fire() {
			for (const timer of pending.splice(0)) if (!timer.cancelled) timer.run();
		},
		get scheduledMs() {
			return pending
				.filter((timer) => !timer.cancelled)
				.map((timer) => timer.ms);
		},
	};
}

/** A modal submission with the given field values, nested in labels like Discord sends them. */
export function modalSubmit(
	customId: string,
	values: Record<string, string>,
	actor?: Actor,
): APIModalSubmitInteraction {
	return {
		...actorFields(actor),
		id: "1",
		application_id: "2",
		type: InteractionType.ModalSubmit,
		token: "test-token",
		version: 1,
		data: {
			custom_id: customId,
			components: Object.entries(values).map(([name, value]) => ({
				type: ComponentType.Label,
				id: 1,
				component: {
					type: ComponentType.TextInput,
					id: 2,
					custom_id: name,
					value,
				},
			})),
		},
	} as unknown as APIModalSubmitInteraction;
}
