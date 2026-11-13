/**
 * The Standard Schema interface (https://standardschema.dev), copied as the
 * spec recommends so Nubis needs no dependency to accept Zod, Valibot,
 * ArkType or any other compliant validator.
 */
export interface StandardSchemaV1<Input = unknown, Output = Input> {
	readonly "~standard": {
		readonly version: 1;
		readonly vendor: string;
		readonly validate: (
			value: unknown,
		) => StandardResult<Output> | Promise<StandardResult<Output>>;
		readonly types?: { readonly input: Input; readonly output: Output };
	};
}

export type StandardResult<Output> =
	| { readonly value: Output; readonly issues?: undefined }
	| { readonly issues: readonly { readonly message: string }[] };

export type SchemaInput<S> =
	S extends StandardSchemaV1<infer I, unknown> ? I : never;
export type SchemaOutput<S> =
	S extends StandardSchemaV1<unknown, infer O> ? O : never;

/**
 * Types component state without validating it. The data comes back from
 * Discord as you sent it, but anyone can craft a custom_id, so prefer a real
 * schema for state you act on (ids you ban, amounts you charge).
 */
export function stateOf<T>(): StandardSchemaV1<T, T> {
	return {
		"~standard": {
			version: 1,
			vendor: "nubis",
			validate: (value) => ({ value: value as T }),
		},
	};
}
