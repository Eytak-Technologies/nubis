import type { Scheduler, Transport } from "@nubisjs/core";
import {
	type APIInteractionResponse,
	type APIInteractionResponseCallbackData,
	type APIModalInteractionResponseCallbackData,
	InteractionResponseType,
} from "discord-api-types/v10";

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

/** What a handler sent to Discord, as a test sees it. */
export interface Recording {
	/** Every call, in order. */
	readonly calls: TransportCall[];
	/** Every message body sent, edited or followed up, in order. */
	readonly messages: APIInteractionResponseCallbackData[];
	/** The text of each of those messages. */
	readonly replies: string[];
	readonly modals: APIModalInteractionResponseCallbackData[];
	/** Call types in order, e.g. ["respond:5", "editOriginal"]. */
	readonly trace: string[];
	/** File names uploaded with each call that had files. */
	readonly uploads: { readonly call: string; readonly files: string[] }[];
}

/** A transport that records instead of talking to Discord. */
export function recordingTransport(): Recording & { transport: Transport } {
	const recording: Recording = {
		calls: [],
		messages: [],
		replies: [],
		modals: [],
		trace: [],
		uploads: [],
	};
	const record = (call: TransportCall, files?: readonly { name: string }[]) => {
		recording.calls.push(call);
		const label =
			call.type === "respond" ? `respond:${call.response.type}` : call.type;
		recording.trace.push(label);
		if (files?.length) {
			recording.uploads.push({ call: label, files: files.map((f) => f.name) });
		}
		let body: APIInteractionResponseCallbackData | undefined;
		if (call.type === "editOriginal" || call.type === "followUp")
			body = call.body;
		else if (call.type === "respond") {
			const { response } = call;
			if (
				response.type === InteractionResponseType.ChannelMessageWithSource ||
				response.type === InteractionResponseType.UpdateMessage
			) {
				body = response.data ?? {};
			} else if (response.type === InteractionResponseType.Modal) {
				recording.modals.push(response.data);
			}
		}
		if (body) {
			recording.messages.push(body);
			recording.replies.push(body.content ?? "");
		}
	};

	// Files are typed loosely so this works with any core version's Transport.
	const transport = {
		respond: async (
			response: APIInteractionResponse,
			files?: readonly { name: string }[],
		) => record({ type: "respond", response }, files),
		editOriginal: async (
			body: APIInteractionResponseCallbackData,
			files?: readonly { name: string }[],
		) => record({ type: "editOriginal", body }, files),
		deleteOriginal: async () => record({ type: "deleteOriginal" }),
		followUp: async (
			body: APIInteractionResponseCallbackData,
			files?: readonly { name: string }[],
		) => record({ type: "followUp", body }, files),
	} satisfies Transport;

	return { ...recording, transport };
}

/** A scheduler driven by hand: auto-defer timers fire only when the test says. */
export function manualClock(): {
	readonly schedule: Scheduler;
	/** Fires every pending timer. */
	fire(): void;
} {
	const pending: { run: () => void; cancelled: boolean }[] = [];
	return {
		schedule: (run) => {
			const timer = { run, cancelled: false };
			pending.push(timer);
			return () => {
				timer.cancelled = true;
			};
		},
		fire() {
			for (const timer of pending.splice(0)) if (!timer.cancelled) timer.run();
		},
	};
}
