import {
	type APIApplicationCommandAutocompleteInteraction,
	type APIApplicationCommandInteractionDataOption,
	InteractionResponseType,
} from "discord-api-types/v10";
import { locate } from "./dispatch";
import { type Guard, guardContext, runGuards } from "./guard";
import type { Transport } from "./lifecycle";
import type { Choice } from "./option";
import type { CommandTree } from "./tree";

export interface AutocompleteOptions {
	/** The bot's guards; see DispatchOptions.guards. */
	readonly guards?: readonly Guard[];
}

export type AutocompleteResult =
	| {
			readonly status: "handled";
			readonly path: readonly string[];
			readonly count: number;
	  }
	/** No command, no focused option, or the option has no autocomplete handler. */
	| { readonly status: "unknown"; readonly path: readonly string[] }
	/** A guard denied: no suggestions, so they can't leak what the command would show. */
	| { readonly status: "denied"; readonly path: readonly string[] }
	| {
			readonly status: "error";
			readonly path: readonly string[];
			readonly error: unknown;
	  };

// Discord's limits for suggestions.
const MAX_SUGGESTIONS = 25;
const MAX_NAME = 100;

/**
 * Answers an autocomplete interaction with the focused option's suggestions.
 * Every outcome answers, with an empty list when there's nothing to suggest,
 * because Discord shows an error for autocomplete that doesn't respond.
 */
export async function dispatchAutocomplete(
	tree: CommandTree,
	interaction: APIApplicationCommandAutocompleteInteraction,
	transport: Transport,
	options: AutocompleteOptions = {},
): Promise<AutocompleteResult> {
	const respond = (choices: readonly Choice[]) =>
		transport.respond({
			type: InteractionResponseType.ApplicationCommandAutocompleteResult,
			data: { choices: [...choices] },
		});

	const {
		leaf,
		parents,
		path,
		options: given,
	} = locate(
		tree,
		interaction.data as {
			name: string;
			options?: APIApplicationCommandInteractionDataOption[];
		},
	);
	const focused = given.find((option) => "focused" in option && option.focused);
	const handler =
		focused && leaf?.definition.options[focused.name]?.config.autocomplete;
	if (!leaf || !focused || !handler) {
		await respond([]);
		return { status: "unknown", path };
	}

	try {
		const denial = await runGuards(
			[
				...(options.guards ?? []),
				...parents.flatMap((parent) => parent.folder?.guards ?? []),
				...(leaf.definition.guards ?? []),
			],
			guardContext(interaction),
		);
		if (denial) {
			await respond([]);
			return { status: "denied", path };
		}

		const suggestions = await handler({
			value: String(focused.value ?? ""),
			options: Object.fromEntries(
				given.map((option) => [
					option.name,
					option.value as string | number | boolean,
				]),
			),
			interaction,
		});
		const choices = suggestions
			.slice(0, MAX_SUGGESTIONS)
			.map(({ name, value }) => ({
				name: name.slice(0, MAX_NAME) || String(value),
				value,
			}));
		await respond(choices);
		return { status: "handled", path, count: choices.length };
	} catch (error) {
		await respond([]);
		return { status: "error", path, error };
	}
}
