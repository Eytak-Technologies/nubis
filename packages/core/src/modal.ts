import {
	type APILabelComponent,
	type APIModalSubmitInteraction,
	ComponentType,
	InteractionType,
	TextInputStyle,
} from "discord-api-types/v10";
import {
	type AnySchema,
	type ComponentState,
	type ModalData,
	RUNTIME,
	type RenderArgs,
	type WithRuntime,
	type ComponentRuntime,
} from "./component";
import { assertValidComponentId, encodeCustomId } from "./custom-id";
import { NubisError } from "./errors";
import type { IsRequired } from "./option";
import type { ReplyInput } from "./reply";

// ------------------------------------------------------------- text input

export interface TextInputConfig {
	readonly label: string;
	/** Shown under the label. */
	readonly description?: string;
	/** "short" is one line, "paragraph" a multi-line box. */
	readonly style?: "short" | "paragraph";
	readonly placeholder?: string;
	readonly required?: boolean;
	readonly minLength?: number;
	readonly maxLength?: number;
}

export interface TextInputDefinition<R extends boolean = boolean> {
	readonly kind: "text";
	readonly required: R;
	readonly config: TextInputConfig;
}

/** A modal text field. `required: true` makes its value a `string`, otherwise `string | undefined`. */
export function textInput<const C extends TextInputConfig>(
	config: C,
): TextInputDefinition<IsRequired<C>> {
	return {
		kind: "text",
		required: (config.required ?? false) as IsRequired<C>,
		config,
	};
}

export type FieldMap = Record<string, TextInputDefinition>;

export type ModalValues<F extends FieldMap> = {
	-readonly [K in keyof F]: F[K] extends TextInputDefinition<true>
		? string
		: string | undefined;
};

// ------------------------------------------------------------------ modal

export interface ModalContext<State, F extends FieldMap> {
	readonly state: State;
	/** What the user typed, typed from `fields`. Empty optional fields are `undefined`. */
	readonly values: ModalValues<F>;
	/** The raw interaction from Discord, for anything Nubis doesn't cover yet. */
	readonly interaction: APIModalSubmitInteraction;
	reply(message: ReplyInput): Promise<void>;
	/** Edits the message the modal was opened from. Only works for modals opened by a component. */
	update(message: ReplyInput): Promise<void>;
	editReply(message: ReplyInput): Promise<void>;
	defer(options?: { readonly ephemeral?: boolean }): Promise<void>;
}

export interface ModalOverrides<F extends FieldMap> {
	readonly title?: string;
	/** Prefills fields, e.g. with the current value when editing something. */
	readonly values?: { readonly [K in keyof F]?: string };
}

export interface ModalConfig<
	F extends FieldMap,
	S extends AnySchema | undefined,
> {
	readonly id: string;
	readonly title: string;
	/** Up to five fields. The keys become the field ids and the keys of `values`. */
	readonly fields: F;
	readonly state?: S;
	onSubmit(context: ModalContext<ComponentState<S>, F>): unknown;
}

export interface ModalDefinition<
	F extends FieldMap,
	S extends AnySchema | undefined,
> extends WithRuntime {
	(...args: RenderArgs<S, ModalOverrides<F>>): ModalData;
	readonly kind: "modal";
	readonly fields: F;
}

// Discord's limits for modals.
const MAX_FIELDS = 5;
const MAX_TITLE = 45;
const MAX_LABEL = 45;
const MAX_DESCRIPTION = 100;
const MAX_PLACEHOLDER = 100;
const MAX_TEXT = 4000;
const FIELD_ID = /^[a-zA-Z0-9_-]{1,100}$/;

function checkLength(
	value: string | undefined,
	max: number,
	what: string,
): void {
	if (value !== undefined && (value.length < 1 || value.length > max)) {
		throw new NubisError(
			`${what} must be 1-${max} characters (got ${value.length}).`,
		);
	}
}

function checkFields(id: string, title: string, fields: FieldMap): void {
	const where = `Modal "${id}"`;
	checkLength(title, MAX_TITLE, `${where}: the title`);
	const entries = Object.entries(fields);
	if (entries.length < 1 || entries.length > MAX_FIELDS) {
		throw new NubisError(
			`${where}: needs 1-${MAX_FIELDS} fields (got ${entries.length}).`,
		);
	}
	for (const [name, field] of entries) {
		const at = `${where} field "${name}"`;
		if (!FIELD_ID.test(name)) {
			throw new NubisError(
				`${at}: field names must be letters, digits, "-" or "_".`,
			);
		}
		const { label, description, placeholder, minLength, maxLength } =
			field.config;
		checkLength(label, MAX_LABEL, `${at}: the label`);
		checkLength(description, MAX_DESCRIPTION, `${at}: the description`);
		checkLength(placeholder, MAX_PLACEHOLDER, `${at}: the placeholder`);
		for (const [key, value] of [
			["minLength", minLength],
			["maxLength", maxLength],
		] as const) {
			if (
				value !== undefined &&
				(!Number.isInteger(value) || value < 0 || value > MAX_TEXT)
			) {
				throw new NubisError(
					`${at}: ${key} must be a whole number from 0 to ${MAX_TEXT}.`,
				);
			}
		}
		if (
			minLength !== undefined &&
			maxLength !== undefined &&
			minLength > maxLength
		) {
			throw new NubisError(`${at}: minLength is larger than maxLength.`);
		}
	}
}

function renderField(
	name: string,
	field: TextInputDefinition,
	value?: string,
): APILabelComponent {
	const { label, description, style, placeholder, minLength, maxLength } =
		field.config;
	return {
		type: ComponentType.Label,
		label,
		...(description ? { description } : {}),
		component: {
			type: ComponentType.TextInput,
			custom_id: name,
			style:
				style === "paragraph" ? TextInputStyle.Paragraph : TextInputStyle.Short,
			required: field.required,
			...(placeholder ? { placeholder } : {}),
			...(value === undefined ? {} : { value }),
			...(minLength === undefined ? {} : { min_length: minLength }),
			...(maxLength === undefined ? {} : { max_length: maxLength }),
		},
	};
}

/** Collects text input values from a submission, wherever Discord nested them. */
function submittedValues(
	interaction: APIModalSubmitInteraction,
): Map<string, string> {
	const values = new Map<string, string>();
	const visit = (node: unknown): void => {
		if (typeof node !== "object" || node === null) return;
		const record = node as Record<string, unknown>;
		if (
			record.type === ComponentType.TextInput &&
			typeof record.custom_id === "string" &&
			typeof record.value === "string"
		) {
			values.set(record.custom_id, record.value);
		}
		if (Array.isArray(record.components)) record.components.forEach(visit);
		if (record.component) visit(record.component);
	};
	interaction.data.components.forEach(visit);
	return values;
}

/**
 * A form that pops up over Discord. Open it with `showModal(report(...))`
 * from a command or a component; `onSubmit` gets typed values.
 */
export function modal<
	const F extends FieldMap,
	S extends AnySchema | undefined = undefined,
>(config: ModalConfig<F, S>): ModalDefinition<F, S> {
	assertValidComponentId(config.id);
	checkFields(config.id, config.title, config.fields);
	const hasState = config.state !== undefined;

	const render = (...args: unknown[]): ModalData => {
		const [state, overrides] = (hasState ? args : [undefined, args[0]]) as [
			unknown,
			ModalOverrides<F> | undefined,
		];
		const title = overrides?.title ?? config.title;
		checkLength(title, MAX_TITLE, `Modal "${config.id}": the title`);
		return {
			custom_id: encodeCustomId(config.id, state),
			title,
			components: Object.entries(config.fields).map(([name, field]) =>
				renderField(name, field, overrides?.values?.[name]),
			),
		};
	};

	const runtime: ComponentRuntime = {
		kind: "modal",
		id: config.id,
		schema: config.state,
		async handle(base, interaction) {
			if (interaction.type !== InteractionType.ModalSubmit) return false;
			const submitted = submittedValues(interaction);
			const values: Record<string, string | undefined> = {};
			for (const [name, field] of Object.entries(config.fields)) {
				const value = submitted.get(name);
				// A required field missing means the form predates a change to the fields.
				if (field.required && !value) return false;
				// Discord sends empty optional fields as "".
				values[name] = value === "" ? undefined : value;
			}
			await config.onSubmit({
				state: base.state as ComponentState<S>,
				values: values as ModalValues<F>,
				interaction,
				reply: base.reply,
				update: base.update,
				editReply: base.editReply,
				defer: base.defer,
			});
			return true;
		},
	};

	return Object.assign(render, {
		id: config.id,
		kind: "modal" as const,
		fields: config.fields,
		[RUNTIME]: runtime,
	}) as unknown as ModalDefinition<F, S>;
}
