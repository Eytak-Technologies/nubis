import {
	type APIApplicationCommandInteractionDataOption,
	type APIChatInputApplicationCommandInteraction,
	type APIInteractionDataResolved,
	type APIMessageComponentInteraction,
	type ComponentType,
	ApplicationCommandType,
	InteractionType,
} from "discord-api-types/v10";
import type { ReplyMessage } from "../reply";

/** A button click or string select, as Discord sends it. */
export function componentInteraction(
	customId: string,
	component:
		| { type: ComponentType.Button }
		| { type: ComponentType.StringSelect; values: string[] },
): APIMessageComponentInteraction {
	return {
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

/** A minimal slash command interaction, enough for routing and option tests. */
export function chatInput(
	name: string,
	options?: APIApplicationCommandInteractionDataOption[],
	resolved?: APIInteractionDataResolved,
): APIChatInputApplicationCommandInteraction {
	return {
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

export function recorder() {
	const replies: string[] = [];
	const messages: { kind: "reply" | "update"; message: ReplyMessage }[] = [];
	return {
		/** Text of every reply, for quick assertions. */
		replies,
		messages,
		responder: {
			reply: async (message: ReplyMessage) => {
				replies.push(message.content ?? "");
				messages.push({ kind: "reply", message });
			},
			update: async (message: ReplyMessage) => {
				messages.push({ kind: "update", message });
			},
		},
	};
}
