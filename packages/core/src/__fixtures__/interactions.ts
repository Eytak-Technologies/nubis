import {
	type APIApplicationCommandInteractionDataOption,
	type APIChatInputApplicationCommandInteraction,
	type APIInteractionDataResolved,
	type APIMessageComponentInteraction,
	type APIModalSubmitInteraction,
	ComponentType,
	ApplicationCommandType,
	InteractionType,
} from "discord-api-types/v10";
import type { ModalData } from "../component";
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
	const modals: ModalData[] = [];
	return {
		modals,
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
			showModal: async (modal: ModalData) => {
				modals.push(modal);
			},
		},
	};
}

/** A modal submission with the given field values, nested in labels like Discord sends them. */
export function modalSubmit(
	customId: string,
	values: Record<string, string>,
): APIModalSubmitInteraction {
	return {
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
