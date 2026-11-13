import type {
	APIMessageComponentInteraction,
	APIModalSubmitInteraction,
} from "discord-api-types/v10";
import {
	type ComponentDefinition,
	type ComponentRuntime,
	RUNTIME,
} from "./component";
import { decodeCustomId } from "./custom-id";
import type { Responder } from "./dispatch";
import { NubisError } from "./errors";
import { toReplyMessage } from "./reply";

export type ComponentRegistry = ReadonlyMap<string, ComponentRuntime>;

export function createComponentRegistry(
	components: readonly ComponentDefinition[],
): ComponentRegistry {
	const registry = new Map<string, ComponentRuntime>();
	for (const component of components) {
		const runtime = component[RUNTIME];
		if (registry.has(runtime.id)) {
			throw new NubisError(
				`Two components or modals use the id "${runtime.id}". Ids must be unique.`,
			);
		}
		registry.set(runtime.id, runtime);
	}
	return registry;
}

export type ComponentDispatchResult =
	| { readonly status: "handled"; readonly id: string }
	| { readonly status: "unknown"; readonly customId: string }
	| { readonly status: "stale"; readonly id: string; readonly reason: string };

export const STALE_MESSAGE =
	"This no longer works. It may be from an older message; try the command again.";

async function route(
	registry: ComponentRegistry,
	interaction: APIMessageComponentInteraction | APIModalSubmitInteraction,
	responder: Responder,
): Promise<ComponentDispatchResult> {
	const customId = interaction.data.custom_id;
	const decoded = decodeCustomId(customId);
	const runtime = registry.get(decoded.id);
	if (!runtime) return { status: "unknown", customId };

	const stale = async (reason: string): Promise<ComponentDispatchResult> => {
		await responder.reply(
			toReplyMessage({ content: STALE_MESSAGE, ephemeral: true }),
		);
		return { status: "stale", id: runtime.id, reason };
	};

	if (!decoded.ok) return stale("custom_id state is not valid JSON");

	let state: unknown;
	if (runtime.schema) {
		const result = await runtime.schema["~standard"].validate(decoded.state);
		if (result.issues) {
			return stale(result.issues.map((issue) => issue.message).join("; "));
		}
		state = result.value;
	}

	const handled = await runtime.handle(
		{
			state,
			reply: (message) => responder.reply(toReplyMessage(message)),
			update: (message) => responder.update(toReplyMessage(message)),
			showModal: (modal) => responder.showModal(modal),
		},
		interaction,
	);
	return handled
		? { status: "handled", id: runtime.id }
		: stale("the interaction doesn't match this component");
}

/** Routes a button click or select to its component, with its state validated. */
export function dispatchComponent(
	registry: ComponentRegistry,
	interaction: APIMessageComponentInteraction,
	responder: Responder,
): Promise<ComponentDispatchResult> {
	return route(registry, interaction, responder);
}

/** Routes a modal submission to its modal, with state and values validated. */
export function dispatchModal(
	registry: ComponentRegistry,
	interaction: APIModalSubmitInteraction,
	responder: Responder,
): Promise<ComponentDispatchResult> {
	return route(registry, interaction, responder);
}
