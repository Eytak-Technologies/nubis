import {
	type APIButtonComponentWithCustomId,
	type APIMessageComponentInteraction,
	type APIModalInteractionResponseCallbackData,
	type APIModalSubmitInteraction,
	type APIStringSelectComponent,
	ButtonStyle,
	ComponentType,
	InteractionType,
} from "discord-api-types/v10";
import { assertValidComponentId, encodeCustomId } from "./custom-id";
import { NubisError } from "./errors";
import type { ReplyInput } from "./reply";
import type { SchemaInput, SchemaOutput, StandardSchemaV1 } from "./schema";

export type AnySchema = StandardSchemaV1<unknown, unknown>;

/** A rendered modal, ready for `showModal()`. */
export type ModalData = APIModalInteractionResponseCallbackData;

/** State inside handlers: the schema's output, or `undefined` without one. */
export type ComponentState<S> = [S] extends [undefined]
	? undefined
	: SchemaOutput<S>;

/** Arguments for rendering: state first when the component has a schema. */
export type RenderArgs<S, O> = [S] extends [undefined]
	? [overrides?: O]
	: [state: SchemaInput<S>, overrides?: O];

export interface ComponentContext<State> {
	readonly state: State;
	/** The raw interaction from Discord, for anything Nubis doesn't cover yet. */
	readonly interaction: APIMessageComponentInteraction;
	/** Sends a new message. */
	reply(message: ReplyInput): Promise<void>;
	/** Edits the message the component is on. Call it before reply(). */
	update(message: ReplyInput): Promise<void>;
	/** Edits the first reply. */
	editReply(message: ReplyInput): Promise<void>;
	/** Shows "thinking…" and a reply to come. */
	defer(options?: { readonly ephemeral?: boolean }): Promise<void>;
	/**
	 * Acknowledges the click without a message; update() can still edit later.
	 * Nubis does this on its own after two seconds.
	 */
	deferUpdate(): Promise<void>;
	/** Opens a modal. Must be the first response, so call it before reply(). */
	showModal(modal: ModalData): Promise<void>;
}

/** The parts of a handler context that don't depend on the interaction type. */
export interface HandlerBase {
	readonly state: unknown;
	reply(message: ReplyInput): Promise<void>;
	update(message: ReplyInput): Promise<void>;
	editReply(message: ReplyInput): Promise<void>;
	defer(options?: { readonly ephemeral?: boolean }): Promise<void>;
	deferUpdate(): Promise<void>;
	showModal(modal: ModalData): Promise<void>;
}

/** What dispatch needs from any component or modal, whatever its state type. */
export interface ComponentRuntime {
	readonly kind: "button" | "string-select" | "modal";
	readonly id: string;
	readonly schema: AnySchema | undefined;
	/** Returns false when the interaction doesn't fit (a stale message or form). */
	handle(
		base: HandlerBase,
		interaction: APIMessageComponentInteraction | APIModalSubmitInteraction,
	): Promise<boolean>;
}

export const RUNTIME = "~nubis";

export interface WithRuntime {
	readonly id: string;
	readonly [RUNTIME]: ComponentRuntime;
}

function isMessageComponent(
	interaction: APIMessageComponentInteraction | APIModalSubmitInteraction,
): interaction is APIMessageComponentInteraction {
	return interaction.type === InteractionType.MessageComponent;
}

function checkId(id: string): void {
	assertValidComponentId(id);
}

// ------------------------------------------------------------------ button

const BUTTON_STYLES = {
	primary: ButtonStyle.Primary,
	secondary: ButtonStyle.Secondary,
	success: ButtonStyle.Success,
	danger: ButtonStyle.Danger,
} as const;

export type ButtonStyleName = keyof typeof BUTTON_STYLES;

export interface ButtonOverrides {
	readonly label?: string;
	readonly style?: ButtonStyleName;
	readonly disabled?: boolean;
}

export interface ButtonConfig<S extends AnySchema | undefined> {
	/** Routes clicks to this button. Changing it makes buttons already sent stop working. */
	readonly id: string;
	readonly label: string;
	readonly style?: ButtonStyleName;
	/** Validates the state that comes back with each click. */
	readonly state?: S;
	onClick(context: ComponentContext<ComponentState<S>>): unknown;
}

export interface ButtonDefinition<
	S extends AnySchema | undefined,
> extends WithRuntime {
	(...args: RenderArgs<S, ButtonOverrides>): APIButtonComponentWithCustomId;
	readonly kind: "button";
}

export function button<S extends AnySchema | undefined = undefined>(
	config: ButtonConfig<S>,
): ButtonDefinition<S> {
	checkId(config.id);
	const hasState = config.state !== undefined;

	const render = (...args: unknown[]): APIButtonComponentWithCustomId => {
		const [state, overrides] = (hasState ? args : [undefined, args[0]]) as [
			unknown,
			ButtonOverrides | undefined,
		];
		return {
			type: ComponentType.Button,
			custom_id: encodeCustomId(config.id, state),
			label: overrides?.label ?? config.label,
			style: BUTTON_STYLES[overrides?.style ?? config.style ?? "secondary"],
			...(overrides?.disabled ? { disabled: true } : {}),
		};
	};

	const runtime: ComponentRuntime = {
		kind: "button",
		id: config.id,
		schema: config.state,
		async handle(base, interaction) {
			if (
				!isMessageComponent(interaction) ||
				interaction.data.component_type !== ComponentType.Button
			) {
				return false;
			}
			await config.onClick({
				...base,
				interaction,
			} as ComponentContext<ComponentState<S>>);
			return true;
		},
	};

	return Object.assign(render, {
		id: config.id,
		kind: "button" as const,
		[RUNTIME]: runtime,
	}) as unknown as ButtonDefinition<S>;
}

// ----------------------------------------------------------- string select

export interface SelectOption<V extends string = string> {
	readonly label: string;
	readonly value: V;
	readonly description?: string;
	readonly default?: boolean;
}

export interface StringSelectOverrides {
	readonly placeholder?: string;
	readonly disabled?: boolean;
}

export interface StringSelectConfig<
	O extends readonly SelectOption[],
	S extends AnySchema | undefined,
> {
	readonly id: string;
	readonly options: O;
	readonly placeholder?: string;
	readonly minValues?: number;
	readonly maxValues?: number;
	readonly state?: S;
	onSelect(
		context: ComponentContext<ComponentState<S>> & {
			/** The chosen values, typed from `options`. */
			readonly values: O[number]["value"][];
		},
	): unknown;
}

export interface StringSelectDefinition<
	O extends readonly SelectOption[],
	S extends AnySchema | undefined,
> extends WithRuntime {
	(...args: RenderArgs<S, StringSelectOverrides>): APIStringSelectComponent;
	readonly kind: "string-select";
	readonly options: O;
}

// Discord's limits for string selects.
const MAX_SELECT_OPTIONS = 25;

export function stringSelect<
	const O extends readonly SelectOption[],
	S extends AnySchema | undefined = undefined,
>(config: StringSelectConfig<O, S>): StringSelectDefinition<O, S> {
	checkId(config.id);
	const where = `Select "${config.id}"`;
	if (config.options.length < 1 || config.options.length > MAX_SELECT_OPTIONS) {
		throw new NubisError(
			`${where}: needs 1-${MAX_SELECT_OPTIONS} options (got ${config.options.length}).`,
		);
	}
	const allowed = new Set(config.options.map((option) => option.value));
	if (allowed.size !== config.options.length) {
		throw new NubisError(`${where}: option values must be unique.`);
	}
	const hasState = config.state !== undefined;

	const render = (...args: unknown[]): APIStringSelectComponent => {
		const [state, overrides] = (hasState ? args : [undefined, args[0]]) as [
			unknown,
			StringSelectOverrides | undefined,
		];
		const placeholder = overrides?.placeholder ?? config.placeholder;
		return {
			type: ComponentType.StringSelect,
			custom_id: encodeCustomId(config.id, state),
			options: config.options.map((option) => ({ ...option })),
			...(placeholder ? { placeholder } : {}),
			...(config.minValues === undefined
				? {}
				: { min_values: config.minValues }),
			...(config.maxValues === undefined
				? {}
				: { max_values: config.maxValues }),
			...(overrides?.disabled ? { disabled: true } : {}),
		};
	};

	const runtime: ComponentRuntime = {
		kind: "string-select",
		id: config.id,
		schema: config.state,
		async handle(base, interaction) {
			if (!isMessageComponent(interaction)) return false;
			const data = interaction.data;
			if (data.component_type !== ComponentType.StringSelect) return false;
			// Values outside the options mean the message predates a change to them.
			if (!data.values.every((value) => allowed.has(value))) return false;
			await config.onSelect({
				...({ ...base, interaction } as ComponentContext<ComponentState<S>>),
				values: data.values as O[number]["value"][],
			});
			return true;
		},
	};

	return Object.assign(render, {
		id: config.id,
		kind: "string-select" as const,
		options: config.options,
		[RUNTIME]: runtime,
	}) as unknown as StringSelectDefinition<O, S>;
}

export type ComponentDefinition = WithRuntime;
