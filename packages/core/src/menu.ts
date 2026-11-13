import {
	type APIContextMenuInteraction,
	type APIInteractionDataResolvedGuildMember,
	type APIMessage,
	type APIMessageApplicationCommandInteraction,
	type APIUser,
	type APIUserApplicationCommandInteraction,
	ApplicationCommandType,
	type RESTPostAPIContextMenuApplicationCommandsJSONBody,
} from "discord-api-types/v10";
import type { TopLevelSettings } from "./command";
import type { ModalData } from "./component";
import { answerError, type DispatchOptions } from "./dispatch";
import { NubisError } from "./errors";
import { type Guard, guardContext, runGuards } from "./guard";
import { createLifecycle } from "./lifecycle";
import { type Middleware, runWithMiddleware } from "./middleware";
import type { ReplyInput } from "./reply";
import { topLevelFields } from "./serialize";
import type { Transport } from "./lifecycle";

interface MenuContextBase {
	reply(message: ReplyInput): Promise<void>;
	editReply(message: ReplyInput): Promise<void>;
	defer(options?: { readonly ephemeral?: boolean }): Promise<void>;
	showModal(modal: ModalData): Promise<void>;
}

export interface UserMenuContext extends MenuContextBase {
	/** The user that was right-clicked. */
	readonly target: APIUser;
	/** Their server membership, when used in a server. */
	readonly targetMember: APIInteractionDataResolvedGuildMember | undefined;
	readonly interaction: APIUserApplicationCommandInteraction;
}

export interface MessageMenuContext extends MenuContextBase {
	/** The message that was right-clicked. */
	readonly target: APIMessage;
	readonly interaction: APIMessageApplicationCommandInteraction;
}

interface MenuConfigBase extends TopLevelSettings {
	/** Shown in the right-click menu: 1-32 characters, spaces and capitals allowed ("Report message"). */
	readonly name: string;
	readonly ephemeral?: boolean;
	readonly guards?: readonly Guard[];
	readonly middleware?: readonly Middleware[];
}

export interface UserMenuConfig extends MenuConfigBase {
	run(context: UserMenuContext): unknown;
}

export interface MessageMenuConfig extends MenuConfigBase {
	run(context: MessageMenuContext): unknown;
}

export type MenuDefinition =
	| {
			readonly kind: "user";
			readonly name: string;
			readonly config: UserMenuConfig;
	  }
	| {
			readonly kind: "message";
			readonly name: string;
			readonly config: MessageMenuConfig;
	  };

const MAX_NAME = 32;

function checkName(name: string): void {
	if (name.trim().length === 0 || name.length > MAX_NAME) {
		throw new NubisError(
			`Context menu name "${name}" must be 1-${MAX_NAME} characters and not blank.`,
		);
	}
}

/** A command in the right-click menu on users ("Apps → View profile"). */
export function userCommand(config: UserMenuConfig): MenuDefinition {
	checkName(config.name);
	return { kind: "user", name: config.name, config };
}

/** A command in the right-click menu on messages ("Apps → Report message"). */
export function messageCommand(config: MessageMenuConfig): MenuDefinition {
	checkName(config.name);
	return { kind: "message", name: config.name, config };
}

export type MenuPayload = RESTPostAPIContextMenuApplicationCommandsJSONBody;

// Discord's limit per menu type for an app.
const MAX_PER_TYPE = 15;

const TYPES = {
	user: ApplicationCommandType.User,
	message: ApplicationCommandType.Message,
} as const;

/** The JSON bodies for context menu commands, to send along with slash commands. */
export function toMenuPayloads(
	menus: readonly MenuDefinition[],
): MenuPayload[] {
	for (const kind of ["user", "message"] as const) {
		const names = menus
			.filter((menu) => menu.kind === kind)
			.map((menu) => menu.name);
		if (names.length > MAX_PER_TYPE) {
			throw new NubisError(
				`An app can have at most ${MAX_PER_TYPE} ${kind} context menu commands (got ${names.length}).`,
			);
		}
		const duplicate = names.find(
			(name, index) => names.indexOf(name) !== index,
		);
		if (duplicate)
			throw new NubisError(
				`Two ${kind} context menu commands are named "${duplicate}".`,
			);
	}
	return menus.map((menu) => ({
		type: TYPES[menu.kind],
		name: menu.name,
		...topLevelFields(menu.config),
	})) as MenuPayload[];
}

export type MenuDispatchResult =
	| {
			readonly status: "handled";
			readonly name: string;
			readonly responded: boolean;
	  }
	| { readonly status: "unknown"; readonly name: string }
	| {
			readonly status: "denied";
			readonly name: string;
			readonly message: string;
	  }
	| {
			readonly status: "error";
			readonly name: string;
			readonly error: unknown;
	  };

/** Routes a right-click menu interaction to its command, with the same lifecycle as slash commands. */
export async function dispatchMenu(
	menus: readonly MenuDefinition[],
	interaction: APIContextMenuInteraction,
	transport: Transport,
	options: DispatchOptions = {},
): Promise<MenuDispatchResult> {
	const kind =
		interaction.data.type === ApplicationCommandType.User ? "user" : "message";
	const name = interaction.data.name;
	const menu = menus.find(
		(candidate) => candidate.kind === kind && candidate.name === name,
	);
	const lifecycle = createLifecycle(transport, {
		kind: "command",
		ephemeral: menu?.config.ephemeral,
		autoDeferMs: options.autoDeferMs,
		schedule: options.schedule,
	});

	if (!menu) {
		await lifecycle.reply({
			content: "This isn't available anymore.",
			ephemeral: true,
		});
		await lifecycle.finish();
		return { status: "unknown", name };
	}

	try {
		const context = guardContext(interaction);
		const denial = await runGuards(
			[...(options.guards ?? []), ...(menu.config.guards ?? [])],
			context,
		);
		if (denial) {
			await lifecycle.reply({ content: denial.message, ephemeral: true });
			await lifecycle.finish();
			return { status: "denied", name, message: denial.message };
		}

		const base = {
			reply: lifecycle.reply,
			editReply: lifecycle.editReply,
			defer: lifecycle.defer,
			showModal: lifecycle.showModal,
		};
		const { deny: _deny, ...middlewareBase } = context;
		await runWithMiddleware(
			[...(options.middleware ?? []), ...(menu.config.middleware ?? [])],
			{ ...middlewareBase, name, kind: "command" },
			async () => {
				const targetId = interaction.data.target_id;
				if (menu.kind === "user") {
					const data = (interaction as APIUserApplicationCommandInteraction)
						.data;
					const target = data.resolved.users[targetId];
					if (!target)
						throw new NubisError(
							`Discord didn't include the user for "${name}".`,
						);
					await menu.config.run({
						...base,
						target,
						targetMember: data.resolved.members?.[targetId],
						interaction: interaction as APIUserApplicationCommandInteraction,
					});
				} else {
					const data = (interaction as APIMessageApplicationCommandInteraction)
						.data;
					const target = data.resolved.messages[targetId];
					if (!target)
						throw new NubisError(
							`Discord didn't include the message for "${name}".`,
						);
					await menu.config.run({
						...base,
						target,
						interaction: interaction as APIMessageApplicationCommandInteraction,
					});
				}
			},
		);
	} catch (error) {
		await answerError(lifecycle);
		await lifecycle.finish();
		return { status: "error", name, error };
	}
	const { responded } = await lifecycle.finish();
	return { status: "handled", name, responded };
}
