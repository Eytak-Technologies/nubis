import {
	type APIInteractionResponse,
	type APIInteractionResponseCallbackData,
	type APIModalInteractionResponseCallbackData,
	InteractionResponseType,
} from "discord-api-types/v10";
import { NubisError } from "./errors";
import { settleStateWrites } from "./store";
import {
	type ReplyInput,
	type ReplyMessage,
	toMessageBody,
	toReplyMessage,
} from "./reply";

/**
 * The four calls Discord offers for answering an interaction. The gateway
 * transport makes them over REST; the HTTP transport answers `respond` in the
 * HTTP response. Everything about *when* to call which lives in core.
 */
export interface Transport {
	/** The interaction callback. Exactly once, within three seconds. */
	respond(response: APIInteractionResponse): Promise<void>;
	/** Edits the message the initial response created or acknowledged. */
	editOriginal(body: APIInteractionResponseCallbackData): Promise<void>;
	deleteOriginal(): Promise<void>;
	followUp(body: APIInteractionResponseCallbackData): Promise<void>;
}

/** Runs `run` after `ms`; returns a function that cancels it. Swappable in tests. */
export type Scheduler = (run: () => void, ms: number) => () => void;

// Core builds without Node or Bun types so it can't lean on either. Timers
// exist in every runtime Nubis targets; these are the two it needs.
declare function setTimeout(run: () => void, ms: number): unknown;
declare function clearTimeout(timer: unknown): void;

const defaultScheduler: Scheduler = (run, ms) => {
	const timer = setTimeout(run, ms);
	return () => clearTimeout(timer);
};

export type InteractionKind = "command" | "component" | "modal";

export interface LifecycleOptions {
	readonly kind: InteractionKind;
	/** Whether replies are ephemeral unless a reply says otherwise. */
	readonly ephemeral?: boolean;
	/**
	 * Acknowledge automatically if nothing has answered after this many
	 * milliseconds. Discord's limit is 3000; the default leaves room for the
	 * network. `false` turns it off.
	 */
	readonly autoDeferMs?: number | false;
	readonly schedule?: Scheduler;
}

export const DEFAULT_AUTO_DEFER_MS = 2000;

type Phase =
	| { readonly type: "initial" }
	/** "Thinking…" shown; the first reply replaces it. */
	| { readonly type: "deferred"; readonly ephemeral: boolean }
	/** A component click acknowledged silently; update() edits its message. */
	| { readonly type: "deferred-update" }
	| { readonly type: "replied" }
	| { readonly type: "updated" }
	| { readonly type: "modal" };

export interface Lifecycle {
	/** Sends a message. The first one answers the interaction, later ones are follow-ups. */
	reply(message: ReplyInput): Promise<void>;
	/** Edits the message a component is on. Only for components and modals opened from one. */
	update(message: ReplyInput): Promise<void>;
	/** Edits the first reply, e.g. to show progress. */
	editReply(message: ReplyInput): Promise<void>;
	/** Shows "thinking…" for work that takes longer than three seconds. */
	defer(options?: { readonly ephemeral?: boolean }): Promise<void>;
	/** Acknowledges a component click without a message; update() can still edit later. */
	deferUpdate(): Promise<void>;
	/** Opens a modal. Only as the first response. */
	showModal(modal: APIModalInteractionResponseCallbackData): Promise<void>;
	/** Stops the auto-defer timer and says whether anything answered. */
	finish(): Promise<{ readonly responded: boolean }>;
}

export function createLifecycle(
	transport: Transport,
	options: LifecycleOptions,
): Lifecycle {
	const { kind } = options;
	const defaultEphemeral = options.ephemeral ?? false;
	let phase: Phase = { type: "initial" };

	// Every call goes through one queue, so a reply and the auto-defer timer
	// can't both answer, and calls made without await still run in order.
	let queue: Promise<unknown> = Promise.resolve();
	const serial = <T>(work: () => Promise<T>): Promise<T> => {
		// Component state written to a store must be saved before the message
		// carrying the component reaches Discord, or a fast click could miss it.
		const next = queue.then(settleStateWrites).then(work);
		queue = next.catch(() => {});
		return next;
	};

	const ephemeralOf = (message: ReplyMessage) =>
		message.ephemeral ?? defaultEphemeral;

	const deferNow = async (ephemeral: boolean) => {
		await transport.respond({
			type: InteractionResponseType.DeferredChannelMessageWithSource,
			data: ephemeral ? { flags: 1 << 6 } : {},
		});
		phase = { type: "deferred", ephemeral };
	};

	const deferUpdateNow = async () => {
		await transport.respond({
			type: InteractionResponseType.DeferredMessageUpdate,
		});
		phase = { type: "deferred-update" };
	};

	const cancelTimer =
		options.autoDeferMs === false
			? () => {}
			: (options.schedule ?? defaultScheduler)(() => {
					void serial(async () => {
						if (phase.type !== "initial") return;
						// A silent acknowledgement for clicks, "thinking…" for commands and forms.
						if (kind === "component") await deferUpdateNow();
						else await deferNow(defaultEphemeral);
					});
				}, options.autoDeferMs ?? DEFAULT_AUTO_DEFER_MS);

	const afterModal = () =>
		new NubisError(
			"The interaction was answered with a modal; its submission is a new interaction.",
		);

	return {
		reply: (input) =>
			serial(async () => {
				const message = toReplyMessage(input);
				const ephemeral = ephemeralOf(message);
				switch (phase.type) {
					case "initial":
						cancelTimer();
						await transport.respond({
							type: InteractionResponseType.ChannelMessageWithSource,
							data: toMessageBody(message, ephemeral),
						});
						phase = { type: "replied" };
						return;
					case "deferred":
						if (phase.ephemeral === ephemeral) {
							await transport.editOriginal(toMessageBody(message, ephemeral));
						} else {
							// Visibility is fixed when deferring. Swap "thinking…" for a
							// follow-up with the visibility this reply asked for.
							await transport.deleteOriginal();
							await transport.followUp(toMessageBody(message, ephemeral));
						}
						phase = { type: "replied" };
						return;
					case "modal":
						throw afterModal();
					default:
						await transport.followUp(toMessageBody(message, ephemeral));
				}
			}),

		update: (input) =>
			serial(async () => {
				if (kind === "command") {
					throw new NubisError(
						"update() edits the message a component is on; commands have none.",
					);
				}
				const body = toMessageBody(toReplyMessage(input), false);
				switch (phase.type) {
					case "initial":
						cancelTimer();
						await transport.respond({
							type: InteractionResponseType.UpdateMessage,
							data: body,
						});
						phase = { type: "updated" };
						return;
					case "deferred-update":
					case "updated":
						await transport.editOriginal(body);
						phase = { type: "updated" };
						return;
					case "modal":
						throw afterModal();
					default:
						throw new NubisError(
							"update() must come before reply() or defer(): after those, the interaction's message is the reply, not the one the component is on.",
						);
				}
			}),

		editReply: (input) =>
			serial(async () => {
				const message = toReplyMessage(input);
				if (phase.type === "replied" || phase.type === "deferred") {
					const ephemeral =
						phase.type === "deferred" ? phase.ephemeral : ephemeralOf(message);
					await transport.editOriginal(toMessageBody(message, ephemeral));
					phase = { type: "replied" };
					return;
				}
				throw new NubisError("editReply() needs a reply or defer() first.");
			}),

		defer: (deferOptions) =>
			serial(async () => {
				if (phase.type !== "initial") return; // Already answered: nothing to wait for.
				cancelTimer();
				await deferNow(deferOptions?.ephemeral ?? defaultEphemeral);
			}),

		deferUpdate: () =>
			serial(async () => {
				if (kind === "command") {
					throw new NubisError(
						"deferUpdate() is for components; use defer() in commands.",
					);
				}
				if (phase.type !== "initial") return;
				cancelTimer();
				await deferUpdateNow();
			}),

		showModal: (modal) =>
			serial(async () => {
				if (kind === "modal") {
					throw new NubisError("A modal submission can't open another modal.");
				}
				if (phase.type !== "initial") {
					throw new NubisError(
						"showModal() must be the first response. Call it before reply() or defer(), and within three seconds: Nubis can't auto-defer and still open a modal.",
					);
				}
				cancelTimer();
				await transport.respond({
					type: InteractionResponseType.Modal,
					data: modal,
				});
				phase = { type: "modal" };
			}),

		finish: () =>
			serial(async () => {
				cancelTimer();
				return { responded: phase.type !== "initial" };
			}),
	};
}
