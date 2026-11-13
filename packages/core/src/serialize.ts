import {
	type APIApplicationCommandBasicOption,
	type APIApplicationCommandOption,
	ApplicationCommandOptionType,
	ApplicationCommandType,
	type RESTPostAPIChatInputApplicationCommandsJSONBody,
} from "discord-api-types/v10";
import { NubisError } from "./errors";
import { assertValidDescription, assertValidName } from "./names";
import type { OptionDefinition, OptionKind } from "./option";
import type { CommandLeaf, CommandNode, CommandTree } from "./tree";

export type CommandPayload = RESTPostAPIChatInputApplicationCommandsJSONBody;

const OPTION_TYPES = {
	string: ApplicationCommandOptionType.String,
	integer: ApplicationCommandOptionType.Integer,
	number: ApplicationCommandOptionType.Number,
	boolean: ApplicationCommandOptionType.Boolean,
	user: ApplicationCommandOptionType.User,
	channel: ApplicationCommandOptionType.Channel,
	role: ApplicationCommandOptionType.Role,
} as const satisfies Record<OptionKind, ApplicationCommandOptionType>;

const MAX_OPTIONS = 25;
const slash = (path: readonly string[]) => `/${path.join(" ")}`;

function serializeOption(
	name: string,
	option: OptionDefinition,
	where: string,
): APIApplicationCommandBasicOption {
	assertValidName(name, where);
	// Discord requires a description; until one is given, the name stands in.
	const description = option.description ?? name;
	assertValidDescription(description, `${where} option "${name}"`);
	return {
		type: OPTION_TYPES[option.kind],
		name,
		description,
		required: option.required,
	} as APIApplicationCommandBasicOption;
}

function serializeLeafOptions(
	leaf: CommandLeaf,
): APIApplicationCommandBasicOption[] {
	const where = slash(leaf.path);
	const entries = Object.entries(leaf.definition.options);
	if (entries.length > MAX_OPTIONS) {
		throw new NubisError(
			`${where}: a command can have at most ${MAX_OPTIONS} options (got ${entries.length}).`,
		);
	}
	const options = entries.map(([name, option]) =>
		serializeOption(name, option, where),
	);
	// Discord rejects optional options listed before required ones. Sorting
	// here keeps the order the author wrote within each group.
	return [
		...options.filter((option) => option.required),
		...options.filter((option) => !option.required),
	];
}

function serializeChild(node: CommandNode): APIApplicationCommandOption {
	if (node.type === "command") {
		assertValidDescription(node.definition.description, slash(node.path));
		return {
			type: ApplicationCommandOptionType.Subcommand,
			name: node.name,
			description: node.definition.description,
			options: serializeLeafOptions(node),
		};
	}
	return {
		type: ApplicationCommandOptionType.SubcommandGroup,
		name: node.name,
		description: node.name,
		options: [...node.children.values()].map((child) => {
			if (child.type !== "command") {
				throw new NubisError(
					`${slash(child.path)}: subcommand groups can't contain other groups.`,
				);
			}
			return serializeChild(child) as never;
		}),
	};
}

/** The JSON body Discord's "bulk overwrite application commands" endpoint takes. */
export function toCommandPayloads(tree: CommandTree): CommandPayload[] {
	return [...tree.values()].map((node): CommandPayload => {
		if (node.type === "command") {
			assertValidDescription(node.definition.description, slash(node.path));
			return {
				type: ApplicationCommandType.ChatInput,
				name: node.name,
				description: node.definition.description,
				options: serializeLeafOptions(node),
			};
		}
		return {
			type: ApplicationCommandType.ChatInput,
			name: node.name,
			// Folders have no file to describe them yet; the name stands in.
			description: node.name,
			options: [...node.children.values()].map(serializeChild),
		};
	});
}
