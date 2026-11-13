import type {
	APIInteractionDataResolvedChannel,
	APIRole,
	APIUser,
} from "discord-api-types/v10";

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

export interface OptionDefinition<
	K extends OptionKind = OptionKind,
	R extends boolean = boolean,
> {
	readonly kind: K;
	readonly required: R;
	readonly description: string | undefined;
}

export interface OptionConfig {
	readonly required?: boolean;
	readonly description?: string;
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

function define<K extends OptionKind>(kind: K) {
	return <const C extends OptionConfig = Record<never, never>>(
		config?: C,
	): OptionDefinition<K, IsRequired<C>> => ({
		kind,
		required: (config?.required ?? false) as IsRequired<C>,
		description: config?.description,
	});
}

export const option = {
	string: define("string"),
	integer: define("integer"),
	number: define("number"),
	boolean: define("boolean"),
	user: define("user"),
	channel: define("channel"),
	role: define("role"),
};

export type OptionValue<O> =
	O extends OptionDefinition<infer K, infer R>
		? R extends true
			? OptionValues[K]
			: OptionValues[K] | undefined
		: never;

export type OptionMap = Record<string, OptionDefinition>;

export type ResolvedOptions<T extends OptionMap> = {
	[N in keyof T]: OptionValue<T[N]>;
};
