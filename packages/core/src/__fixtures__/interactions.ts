import {
	type APIApplicationCommandInteractionDataOption,
	type APIChatInputApplicationCommandInteraction,
	type APIInteractionDataResolved,
	ApplicationCommandType,
	InteractionType,
} from "discord-api-types/v10";

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
	return {
		replies,
		responder: {
			reply: async (content: string) => {
				replies.push(content);
			},
		},
	};
}
