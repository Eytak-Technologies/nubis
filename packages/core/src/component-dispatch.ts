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
import { answerError } from "./dispatch";
import { NubisError } from "./errors";
import { type Guard, guardContext, runGuards } from "./guard";
import { type Middleware, runWithMiddleware } from "./middleware";
import { createLifecycle, type Scheduler, type Transport } from "./lifecycle";

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
	| {
			readonly status: "handled";
			readonly id: string;
			readonly responded: boolean;
	  }
	| { readonly status: "error"; readonly id: string; readonly error: unknown }
	| { readonly status: "denied"; readonly id: string; readonly message: string }
	| { readonly status: "unknown"; readonly customId: string }
	| { readonly status: "stale"; readonly id: string; readonly reason: string };

export const STALE_MESSAGE =
	"This no longer works. It may be from an older message; try the command again.";

export interface ComponentDispatchOptions {
	readonly autoDeferMs?: number | false;
	readonly schedule?: Scheduler;
	/** Run before every component and modal handler, before their own guards. */
	readonly guards?: readonly Guard[];
	readonly middleware?: readonly Middleware[];
}

async function route(
	registry: ComponentRegistry,
	interaction: APIMessageComponentInteraction | APIModalSubmitInteraction,
	transport: Transport,
	kind: "component" | "modal",
	options: ComponentDispatchOptions,
): Promise<ComponentDispatchResult> {
	const customId = interaction.data.custom_id;
	const decoded = decodeCustomId(customId);
	const runtime = registry.get(decoded.id);
	const lifecycle = createLifecycle(transport, {
		kind,
		autoDeferMs: options.autoDeferMs,
		schedule: options.schedule,
	});

	const stale = async (
		id: string,
		reason: string,
	): Promise<ComponentDispatchResult> => {
		await lifecycle.reply({ content: STALE_MESSAGE, ephemeral: true });
		await lifecycle.finish();
		return { status: "stale", id, reason };
	};

	// A bot only receives clicks on its own messages, so an unknown id is a
	// component this bot has since removed: answer it like any stale one.
	if (!runtime) {
		await lifecycle.reply({ content: STALE_MESSAGE, ephemeral: true });
		await lifecycle.finish();
		return { status: "unknown", customId };
	}
	if (!decoded.ok)
		return stale(runtime.id, "custom_id state is not valid JSON");

	try {
		const context = guardContext(interaction);
		const denial = await runGuards(
			[...(options.guards ?? []), ...runtime.guards],
			context,
		);
		if (denial) {
			await lifecycle.reply({ content: denial.message, ephemeral: true });
			await lifecycle.finish();
			return { status: "denied", id: runtime.id, message: denial.message };
		}

		let raw: unknown;
		if ("key" in decoded) {
			// State kept in a store: a missing key means it expired or the store was reset.
			raw = runtime.store ? await runtime.store.get(decoded.key) : undefined;
			if (raw === undefined)
				return stale(runtime.id, "stored state expired or missing");
		} else {
			raw = decoded.state;
		}

		let state: unknown = runtime.schema ? undefined : raw;
		if (runtime.schema) {
			const result = await runtime.schema["~standard"].validate(raw);
			if (result.issues) {
				return stale(
					runtime.id,
					result.issues.map((issue) => issue.message).join("; "),
				);
			}
			state = result.value;
		}

		const { deny: _deny, ...base } = context;
		let handled = true;
		await runWithMiddleware(
			[...(options.middleware ?? []), ...runtime.middleware],
			{ ...base, name: runtime.id, kind },
			async () => {
				handled = await runtime.handle(
					{
						state,
						reply: lifecycle.reply,
						update: lifecycle.update,
						editReply: lifecycle.editReply,
						defer: lifecycle.defer,
						deferUpdate: lifecycle.deferUpdate,
						showModal: lifecycle.showModal,
					},
					interaction,
				);
			},
		);
		if (!handled)
			return stale(runtime.id, "the interaction doesn't match this component");
	} catch (error) {
		await answerError(lifecycle);
		await lifecycle.finish();
		return { status: "error", id: runtime.id, error };
	}

	// A click whose handler didn't answer is acknowledged silently, so Discord
	// doesn't show "This interaction failed" for buttons that just do something.
	if (kind === "component") await lifecycle.deferUpdate();
	const { responded } = await lifecycle.finish();
	return { status: "handled", id: runtime.id, responded };
}

/** Routes a button click or select to its component, with its state validated. */
export function dispatchComponent(
	registry: ComponentRegistry,
	interaction: APIMessageComponentInteraction,
	transport: Transport,
	options: ComponentDispatchOptions = {},
): Promise<ComponentDispatchResult> {
	return route(registry, interaction, transport, "component", options);
}

/** Routes a modal submission to its modal, with state and values validated. */
export function dispatchModal(
	registry: ComponentRegistry,
	interaction: APIModalSubmitInteraction,
	transport: Transport,
	options: ComponentDispatchOptions = {},
): Promise<ComponentDispatchResult> {
	return route(registry, interaction, transport, "modal", options);
}
