import {
	type APIApplicationCommand,
	ApplicationCommandType,
} from "discord-api-types/v10";
import type { MenuPayload } from "./menu";
import type { CommandPayload } from "./serialize";

/** Anything Nubis registers: slash commands and context menu commands. */
export type AnyCommandPayload = CommandPayload | MenuPayload;

export interface SyncPlan {
	readonly create: readonly AnyCommandPayload[];
	readonly update: readonly {
		readonly id: string;
		readonly payload: AnyCommandPayload;
	}[];
	readonly remove: readonly { readonly id: string; readonly name: string }[];
	readonly unchanged: readonly string[];
}

type Localizations = Readonly<Record<string, string | null>> | null;

type Comparable = {
	type?: number;
	name: string;
	name_localizations?: Localizations;
	description?: string;
	description_localizations?: Localizations;
	required?: boolean;
	options?: readonly Comparable[];
	choices?: readonly {
		name: string;
		name_localizations?: Localizations;
		value: string | number;
	}[];
	autocomplete?: boolean;
	min_value?: number;
	max_value?: number;
	min_length?: number;
	max_length?: number;
	channel_types?: readonly number[];
	default_member_permissions?: string | null;
	contexts?: readonly number[] | null;
	integration_types?: readonly number[];
	nsfw?: boolean;
};

const sorted = (values: readonly number[] | null | undefined) =>
	values ? [...values].sort((a, b) => a - b) : null;

// Only the fields Nubis writes take part in the comparison, with Discord's
// defaults filled in, so values Discord adds on its side (ids, versions,
// `required: false`) don't look like changes. Localizations count: Discord
// returns them when asked with `with_localizations=true`, and an empty or
// missing map is the same as null.
function localizations(map: Localizations | undefined): unknown {
	const entries = Object.entries(map ?? {}).filter(
		(entry): entry is [string, string] => typeof entry[1] === "string",
	);
	return entries.length === 0
		? null
		: Object.fromEntries(entries.sort(([a], [b]) => a.localeCompare(b)));
}

function normalizeOption(option: Comparable): unknown {
	return {
		type: option.type,
		name: option.name,
		name_localizations: localizations(option.name_localizations),
		description: option.description ?? "",
		description_localizations: localizations(option.description_localizations),
		required: option.required ?? false,
		choices:
			option.choices?.map(({ name, name_localizations, value }) => ({
				name,
				name_localizations: localizations(name_localizations),
				value,
			})) ?? null,
		autocomplete: option.autocomplete ?? false,
		min_value: option.min_value ?? null,
		max_value: option.max_value ?? null,
		min_length: option.min_length ?? null,
		max_length: option.max_length ?? null,
		channel_types: sorted(option.channel_types),
		options: (option.options ?? []).map(normalizeOption),
	};
}

function normalize(command: Comparable): unknown {
	const integrationTypes = sorted(command.integration_types);
	return {
		type: command.type ?? ApplicationCommandType.ChatInput,
		name: command.name,
		name_localizations: localizations(command.name_localizations),
		description: command.description ?? "",
		description_localizations: localizations(command.description_localizations),
		default_member_permissions: command.default_member_permissions ?? null,
		contexts: sorted(command.contexts),
		// Discord reports guild install for commands that never set this.
		integration_types:
			integrationTypes === null ||
			(integrationTypes.length === 1 && integrationTypes[0] === 0)
				? null
				: integrationTypes,
		nsfw: command.nsfw ?? false,
		options: (command.options ?? []).map(normalizeOption),
	};
}

const same = (a: Comparable, b: Comparable) =>
	JSON.stringify(normalize(a)) === JSON.stringify(normalize(b));

const MANAGED_TYPES: ReadonlySet<number> = new Set([
	ApplicationCommandType.ChatInput,
	ApplicationCommandType.User,
	ApplicationCommandType.Message,
]);

// A slash command and a context menu can share a name, so type is part of the key.
const keyOf = (command: { type?: number; name: string }) =>
	`${command.type ?? ApplicationCommandType.ChatInput}:${command.name}`;

/**
 * Works out which commands to create, update and delete so Discord matches
 * the bot's code: slash commands and context menu commands. Activity entry
 * point commands are left alone, since Discord manages those.
 */
export function planSync(
	local: readonly AnyCommandPayload[],
	remote: readonly APIApplicationCommand[],
): SyncPlan {
	const managed = remote.filter((command) => MANAGED_TYPES.has(command.type));
	const byKey = new Map(managed.map((command) => [keyOf(command), command]));
	const localKeys = new Set(local.map(keyOf));

	const create: AnyCommandPayload[] = [];
	const update: { id: string; payload: AnyCommandPayload }[] = [];
	const unchanged: string[] = [];

	for (const payload of local) {
		const existing = byKey.get(keyOf(payload));
		if (!existing) create.push(payload);
		else if (same(payload as Comparable, existing as Comparable))
			unchanged.push(payload.name);
		else update.push({ id: existing.id, payload });
	}

	const remove = managed
		.filter((command) => !localKeys.has(keyOf(command)))
		.map(({ id, name }) => ({ id, name }));

	return { create, update, remove, unchanged };
}
