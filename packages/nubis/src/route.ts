import {
	type CommandTree,
	type ComponentDispatchOptions,
	type ComponentRegistry,
	type DispatchOptions,
	dispatch,
	dispatchAutocomplete,
	dispatchComponent,
	dispatchMenu,
	dispatchModal,
	type MenuDefinition,
	type Transport,
} from "@nubisjs/core";
import {
	type APIInteraction,
	ApplicationCommandType,
	InteractionType,
} from "discord-api-types/v10";

/** The parts of a project that answer interactions. A loaded Project fits. */
export interface InteractionProject {
	readonly tree: CommandTree;
	readonly components: ComponentRegistry;
	readonly menus: readonly MenuDefinition[];
}

export type RouteOptions = DispatchOptions & ComponentDispatchOptions;

/**
 * Sends an interaction to the dispatcher for its type. Shared by the HTTP
 * endpoint and the gateway bot, which differ only in their transport.
 */
export function routeInteraction(
	project: InteractionProject,
	interaction: APIInteraction,
	transport: Transport,
	options: RouteOptions,
): Promise<{ readonly status: string; readonly error?: unknown }> {
	switch (interaction.type) {
		case InteractionType.ApplicationCommand:
			return interaction.data.type === ApplicationCommandType.ChatInput
				? dispatch(project.tree, interaction as never, transport, options)
				: dispatchMenu(project.menus, interaction as never, transport, options);
		case InteractionType.MessageComponent:
			return dispatchComponent(
				project.components,
				interaction,
				transport,
				options,
			);
		case InteractionType.ApplicationCommandAutocomplete:
			return dispatchAutocomplete(
				project.tree,
				interaction,
				transport,
				options,
			);
		case InteractionType.ModalSubmit:
			return dispatchModal(project.components, interaction, transport, options);
		default:
			return Promise.resolve({ status: "unsupported" });
	}
}
