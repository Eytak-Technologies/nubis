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
};

// Only the fields Nubis writes take part in the comparison, with Discord's
// defaults filled in, so values Discord adds on its side (ids, versions,
// localizations, `required: false`) don't look like changes.
function normalize(command: Comparable): unknown {
	return {
		type: command.type ?? ApplicationCommandType.ChatInput,
		name: command.name,
		description: command.description ?? "",
		required: command.required ?? false,
		options: (command.options ?? []).map(normalize),
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
