import type {
	APIApplicationCommandAutocompleteInteraction,
	APIInteractionDataResolvedChannel,
	APIRole,
	APIUser,
	ChannelType,
} from "discord-api-types/v10";
import type { NubisApi } from "./api";

/** What each option kind resolves to inside `run()`. */
export interface OptionValues {
	string: string;
	integer: number;
	number: number;
	boolean: boolean;
	user: APIUser;
	channel: APIInteractionDataResolvedChannel;
	role: APIRole;
}

export type OptionKind = keyof OptionValues;

/** A fixed choice. With `choices`, the option's value is typed as the union of their values. */
export interface Choice<V extends string | number = string | number> {
	readonly name: string;
	readonly value: V;
}

export interface AutocompleteContext {
	/** What the user has typed into this option so far. Always a string while typing. */
	readonly value: string;
	/** The other options as typed so far, unvalidated. */
	readonly options: Readonly<
		Record<string, string | number | boolean | undefined>
	>;
	readonly interaction: APIApplicationCommandAutocompleteInteraction;
	readonly api: NubisApi;
}

/** Suggests values while the user types. Up to 25 are shown; Nubis drops the rest. */
export type AutocompleteHandler<V extends string | number> = (
	context: AutocompleteContext,
) => readonly Choice<V>[] | Promise<readonly Choice<V>[]>;

interface BaseOptionConfig {
	readonly required?: boolean;
	/** Shown in Discord's command picker. Defaults to the option name. */
	readonly description?: string;
}

export interface StringOptionConfig extends BaseOptionConfig {
	readonly choices?: readonly Choice<string>[];
	readonly minLength?: number;
	readonly maxLength?: number;
	readonly autocomplete?: AutocompleteHandler<string>;
}

export interface NumberOptionConfig extends BaseOptionConfig {
	readonly choices?: readonly Choice<number>[];
	readonly minValue?: number;
	readonly maxValue?: number;
	readonly autocomplete?: AutocompleteHandler<number>;
}

export interface ChannelOptionConfig extends BaseOptionConfig {
	/** Only these channel types can be picked, e.g. `[ChannelType.GuildText]`. */
	readonly channelTypes?: readonly ChannelType[];
}

export type BasicOptionConfig = BaseOptionConfig;

/** Every setting any option kind can have; what serialization reads. */
export type AnyOptionConfig = StringOptionConfig &
	Omit<NumberOptionConfig, "choices" | "autocomplete"> &
	ChannelOptionConfig & {
		readonly choices?: readonly Choice[];
		readonly autocomplete?: AutocompleteHandler<string | number>;
	};

export interface OptionDefinition<
	K extends OptionKind = OptionKind,
	R extends boolean = boolean,
	// biome-ignore lint/suspicious/noExplicitAny: variance hole for "any value type" in OptionMap
	V = any,
> {
	readonly kind: K;
	readonly required: R;
	readonly description: string | undefined;
	readonly config: AnyOptionConfig;
	/** Type-only: what the value resolves to. */
	readonly "~value"?: V;
}

/**
 * Whether a config marks its option as required. Computed from the config
 * type itself, never inferred from where the option is used: inferring it from
 * context widens `required: true` to `boolean` when options are written
 * inline in `command({ options: { ... } })`.
 */
export type IsRequired<C> = C extends { readonly required: true }
	? true
	: false;

/** The value type: the union of `choices` values when there are choices. */
export type ValueOf<K extends OptionKind, C> = C extends {
	readonly choices: readonly (infer Item)[];
}
	? Item extends { readonly value: infer V }
		? V
		: never
	: OptionValues[K];

function define<K extends OptionKind, Config extends BaseOptionConfig>(
	kind: K,
) {
	return <const C extends Config = Config>(
		config?: C,
	): OptionDefinition<K, IsRequired<C>, ValueOf<K, C>> => ({
		kind,
		required: (config?.required ?? false) as IsRequired<C>,
		description: config?.description,
		config: (config ?? {}) as AnyOptionConfig,
	});
}

export const option = {
	string: define<"string", StringOptionConfig>("string"),
	integer: define<"integer", NumberOptionConfig>("integer"),
	number: define<"number", NumberOptionConfig>("number"),
	boolean: define<"boolean", BasicOptionConfig>("boolean"),
	user: define<"user", BasicOptionConfig>("user"),
	channel: define<"channel", ChannelOptionConfig>("channel"),
	role: define<"role", BasicOptionConfig>("role"),
};

export type OptionValue<O> =
	O extends OptionDefinition<OptionKind, infer R, infer V>
		? R extends true
			? V
			: V | undefined
		: never;

export type OptionMap = Record<string, OptionDefinition>;

export type ResolvedOptions<T extends OptionMap> = {
	-readonly [N in keyof T]: OptionValue<T[N]>;
};
