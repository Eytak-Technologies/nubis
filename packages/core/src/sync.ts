import {
	type APIApplicationCommand,
	ApplicationCommandType,
} from "discord-api-types/v10";
import type { CommandPayload } from "./serialize";

export interface SyncPlan {
	readonly create: readonly CommandPayload[];
	readonly update: readonly {
		readonly id: string;
		readonly payload: CommandPayload;
	}[];
	readonly remove: readonly { readonly id: string; readonly name: string }[];
	readonly unchanged: readonly string[];
}

type Comparable = {
	type?: number;
	name: string;
	description?: string;
	required?: boolean;
	options?: readonly Comparable[];
	choices?: readonly { name: string; value: string | number }[];
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
// localizations, `required: false`) don't look like changes.
function normalizeOption(option: Comparable): unknown {
	return {
		type: option.type,
		name: option.name,
		description: option.description ?? "",
		required: option.required ?? false,
		choices:
			option.choices?.map(({ name, value }) => ({ name, value })) ?? null,
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
		description: command.description ?? "",
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

/**
 * Works out which slash commands to create, update and delete so Discord
 * matches the bot's code. Context menu commands on Discord are left alone.
 */
export function planSync(
	local: readonly CommandPayload[],
	remote: readonly APIApplicationCommand[],
): SyncPlan {
	const remoteChatInput = remote.filter(
		(command) => command.type === ApplicationCommandType.ChatInput,
	);
	const byName = new Map(
		remoteChatInput.map((command) => [command.name, command]),
	);
	const localNames = new Set(local.map((command) => command.name));

	const create: CommandPayload[] = [];
	const update: { id: string; payload: CommandPayload }[] = [];
	const unchanged: string[] = [];

	for (const payload of local) {
		const existing = byName.get(payload.name);
		if (!existing) create.push(payload);
		else if (same(payload, existing as Comparable))
			unchanged.push(payload.name);
		else update.push({ id: existing.id, payload });
	}

	const remove = remoteChatInput
		.filter((command) => !localNames.has(command.name))
		.map(({ id, name }) => ({ id, name }));

	return { create, update, remove, unchanged };
}
