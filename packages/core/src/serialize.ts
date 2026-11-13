import {
	type APIApplicationCommandBasicOption,
	type APIApplicationCommandOption,
	ApplicationCommandOptionType,
	ApplicationCommandType,
	ApplicationIntegrationType,
	InteractionContextType,
	type RESTPostAPIChatInputApplicationCommandsJSONBody,
} from "discord-api-types/v10";
import type {
	CommandContextName,
	IntegrationTypeName,
	TopLevelSettings,
} from "./command";
import { NubisError } from "./errors";
import {
	descriptionLocalizations,
	labelLocalizations,
	nameLocalizations,
	type Localizable,
} from "./localization";
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

// Discord's limits for options.
const MAX_CHOICES = 25;
const MAX_CHOICE_NAME = 100;
const MAX_STRING_CHOICE = 100;
const MAX_TEXT_LENGTH = 6000;

function optionDetails(
	name: string,
	option: OptionDefinition,
	where: string,
): Record<string, unknown> {
	const at = `${where} option "${name}"`;
	const {
		choices,
		autocomplete,
		minLength,
		maxLength,
		minValue,
		maxValue,
		channelTypes,
	} = option.config;
	const details: Record<string, unknown> = {};
	const isNumber = option.kind === "integer" || option.kind === "number";

	if (choices !== undefined) {
		if (autocomplete) {
			throw new NubisError(`${at}: use choices or autocomplete, not both.`);
		}
		if (choices.length < 1 || choices.length > MAX_CHOICES) {
			throw new NubisError(
				`${at}: needs 1-${MAX_CHOICES} choices (got ${choices.length}).`,
			);
		}
		for (const choice of choices) {
			if (choice.name.length < 1 || choice.name.length > MAX_CHOICE_NAME) {
				throw new NubisError(
					`${at}: choice names must be 1-${MAX_CHOICE_NAME} characters.`,
				);
			}
			if (
				typeof choice.value === "string" &&
				choice.value.length > MAX_STRING_CHOICE
			) {
				throw new NubisError(
					`${at}: choice values must be at most ${MAX_STRING_CHOICE} characters.`,
				);
			}
			if (option.kind === "integer" && !Number.isInteger(choice.value)) {
				throw new NubisError(`${at}: integer choices must be whole numbers.`);
			}
		}
		details.choices = choices.map(
			({ name: label, value, nameLocalizations: labels }) => ({
				name: label,
				value,
				...labelLocalizations(
					labels,
					`${at} choice "${label}"`,
					MAX_CHOICE_NAME,
				),
			}),
		);
	}
	if (autocomplete) details.autocomplete = true;

	if (minLength !== undefined || maxLength !== undefined) {
		if (
			(minLength ?? 0) < 0 ||
			(maxLength ?? 1) < 1 ||
			(maxLength ?? 0) > MAX_TEXT_LENGTH ||
			(minLength ?? 0) > MAX_TEXT_LENGTH
		) {
			throw new NubisError(
				`${at}: lengths must be 0-${MAX_TEXT_LENGTH} (maxLength at least 1).`,
			);
		}
		if (
			minLength !== undefined &&
			maxLength !== undefined &&
			minLength > maxLength
		) {
			throw new NubisError(`${at}: minLength is larger than maxLength.`);
		}
		if (minLength !== undefined) details.min_length = minLength;
		if (maxLength !== undefined) details.max_length = maxLength;
	}

	if (isNumber && (minValue !== undefined || maxValue !== undefined)) {
		if (
			minValue !== undefined &&
			maxValue !== undefined &&
			minValue > maxValue
		) {
			throw new NubisError(`${at}: minValue is larger than maxValue.`);
		}
		if (minValue !== undefined) details.min_value = minValue;
		if (maxValue !== undefined) details.max_value = maxValue;
	}

	if (channelTypes !== undefined) {
		if (channelTypes.length === 0) {
			throw new NubisError(
				`${at}: channelTypes needs at least one type; leave it out to allow all.`,
			);
		}
		details.channel_types = [...channelTypes];
	}
	return details;
}

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
		...localized(option.config, `${where} option "${name}"`),
		required: option.required,
		...optionDetails(name, option, where),
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
			...localized(node.definition, slash(node.path)),
			options: serializeLeafOptions(node),
		};
	}
	return {
		type: ApplicationCommandOptionType.SubcommandGroup,
		name: node.name,
		description: folderDescription(node),
		...localized(node.folder ?? {}, `commands/${node.path.join("/")}`),
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

/** A command's, folder's or option's name and description in other languages. */
const localized = (settings: Localizable, where: string) => ({
	...nameLocalizations(settings.nameLocalizations, where),
	...descriptionLocalizations(settings.descriptionLocalizations, where),
});

const CONTEXTS = {
	guild: InteractionContextType.Guild,
	"bot-dm": InteractionContextType.BotDM,
	"private-channel": InteractionContextType.PrivateChannel,
} as const satisfies Record<CommandContextName, InteractionContextType>;

const INTEGRATION_TYPES = {
	guild: ApplicationIntegrationType.GuildInstall,
	user: ApplicationIntegrationType.UserInstall,
} as const satisfies Record<IntegrationTypeName, ApplicationIntegrationType>;

/** Top-level settings shared by commands and folders. */
export function topLevelFields(
	settings: TopLevelSettings,
): Record<string, unknown> {
	return {
		...permissionsField(settings.defaultMemberPermissions),
		...(settings.contexts
			? { contexts: settings.contexts.map((name) => CONTEXTS[name]) }
			: {}),
		...(settings.integrationTypes
			? {
					integration_types: settings.integrationTypes.map(
						(name) => INTEGRATION_TYPES[name],
					),
				}
			: {}),
		...(settings.nsfw ? { nsfw: true } : {}),
	};
}

const hasTopLevel = (settings: TopLevelSettings) =>
	settings.defaultMemberPermissions !== undefined ||
	settings.contexts !== undefined ||
	settings.integrationTypes !== undefined ||
	settings.nsfw !== undefined;

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
		if (node.path.length > 1 && hasTopLevel(node.definition)) {
			throw new NubisError(
				`${slash(node.path)}: defaultMemberPermissions, contexts, integrationTypes and nsfw only work on top-level commands. Set them on the commands/${node.path[0]} folder instead.`,
			);
		}
		return;
	}
	if (node.path.length > 1 && node.folder && hasTopLevel(node.folder)) {
		throw new NubisError(
			`commands/${node.path.join("/")}: defaultMemberPermissions, contexts, integrationTypes and nsfw only work on top-level folders.`,
		);
	}
	for (const child of node.children.values()) assertNoNestedPermissions(child);
}

// Discord's limit on top-level slash commands per app.
const MAX_COMMANDS = 100;

/** The JSON body Discord's "bulk overwrite application commands" endpoint takes. */
export function toCommandPayloads(tree: CommandTree): CommandPayload[] {
	if (tree.size > MAX_COMMANDS) {
		throw new NubisError(
			`An app can have at most ${MAX_COMMANDS} top-level slash commands (got ${tree.size}). Group some into folders: subcommands don't count.`,
		);
	}
	return [...tree.values()].map((node): CommandPayload => {
		assertNoNestedPermissions(node);
		if (node.type === "command") {
			assertValidDescription(node.definition.description, slash(node.path));
			return {
				type: ApplicationCommandType.ChatInput,
				name: node.name,
				description: node.definition.description,
				...localized(node.definition, slash(node.path)),
				options: serializeLeafOptions(node),
				...topLevelFields(node.definition),
			};
		}
		return {
			type: ApplicationCommandType.ChatInput,
			name: node.name,
			description: folderDescription(node),
			...localized(node.folder ?? {}, `commands/${node.path.join("/")}`),
			options: [...node.children.values()].map(serializeChild),
			...topLevelFields(node.folder ?? {}),
		};
	});
}
