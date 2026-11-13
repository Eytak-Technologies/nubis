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
import type {
	CommandLeaf,
	CommandNode,
	CommandParent,
	CommandTree,
} from "./tree";

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
		description: folderDescription(node),
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

const permissionsField = (permissions: readonly bigint[] | undefined) =>
	permissions === undefined
		? {}
		: {
				default_member_permissions: permissions
					.reduce((all, permission) => all | permission, 0n)
					.toString(),
			};

const folderDescription = (node: CommandParent) => {
	const description = node.folder?.description ?? node.name;
	assertValidDescription(description, `commands/${node.path.join("/")}`);
	return description;
};

// Discord only reads default_member_permissions on top-level commands.
function assertNoNestedPermissions(node: CommandNode): void {
	if (node.type === "command") {
		if (node.path.length > 1 && node.definition.defaultMemberPermissions) {
			throw new NubisError(
				`${slash(node.path)}: defaultMemberPermissions only works on top-level commands. Set it on the commands/${node.path[0]} folder instead.`,
			);
		}
		return;
	}
	if (node.path.length > 1 && node.folder?.defaultMemberPermissions) {
		throw new NubisError(
			`commands/${node.path.join("/")}: defaultMemberPermissions only works on top-level folders.`,
		);
	}
	for (const child of node.children.values()) assertNoNestedPermissions(child);
}

/** The JSON body Discord's "bulk overwrite application commands" endpoint takes. */
export function toCommandPayloads(tree: CommandTree): CommandPayload[] {
	return [...tree.values()].map((node): CommandPayload => {
		assertNoNestedPermissions(node);
		if (node.type === "command") {
			assertValidDescription(node.definition.description, slash(node.path));
			return {
				type: ApplicationCommandType.ChatInput,
				name: node.name,
				description: node.definition.description,
				options: serializeLeafOptions(node),
				...permissionsField(node.definition.defaultMemberPermissions),
			};
		}
		return {
			type: ApplicationCommandType.ChatInput,
			name: node.name,
			description: folderDescription(node),
			options: [...node.children.values()].map(serializeChild),
			...permissionsField(node.folder?.defaultMemberPermissions),
		};
	});
}
