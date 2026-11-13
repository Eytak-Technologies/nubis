import {
	buildCommandTree,
	type CommandDefinition,
	type ComponentDefinition,
	type ComponentDispatchOptions,
	createComponentRegistry,
	type DispatchOptions,
	dispatch,
	dispatchComponent,
	dispatchMenu,
	dispatchModal,
	type FieldMap,
	type MenuDefinition,
	type ModalDefinition,
	type OptionMap,
	type OptionValue,
} from "@nubisjs/core";
import {
	type APIApplicationCommandInteractionDataOption,
	type APIInteractionDataResolvedChannel,
	type APIRole,
	type APIUser,
	ApplicationCommandOptionType,
	ApplicationCommandType,
	ComponentType,
	InteractionType,
} from "discord-api-types/v10";
import { fake, fakeId } from "./fake";
import { type Recording, recordingTransport } from "./recorder";

/** Who is using the command or component. */
export interface Actor {
	/** Defaults to a fresh fake user. */
	readonly user?: APIUser;
	/** Run in DMs instead of a server. Servers are the default. */
	readonly dm?: boolean;
	readonly guildId?: string;
	readonly channelId?: string;
	/** Role ids the member has. */
	readonly roles?: readonly string[];
	/** The member's permission bits (`PermissionFlagsBits`). None by default. */
	readonly permissions?: bigint;
	/** The bot's permissions in the channel. None by default. */
	readonly appPermissions?: bigint;
	/** For components: who ran the command that sent the message. */
	readonly invoker?: APIUser;
	/** The user's Discord language, as `interaction.locale`. Defaults to "en-US". */
	readonly locale?: string;
	/** The server's language, as `interaction.guild_locale`. Defaults to "en-US". */
	readonly guildLocale?: string;
}

export interface TestResult extends Recording {
	/** The dispatch status: "handled", "denied", "stale", "error", … */
	readonly status: string;
	/** What the handler threw, when status is "error". */
	readonly error?: unknown;
	/** Whether the first message was only visible to the user. */
	readonly ephemeral: boolean;
}

type Options = DispatchOptions & ComponentDispatchOptions;

const EPHEMERAL = 1 << 6;

function interactionBase(actor: Actor, type: InteractionType) {
	const user = actor.user ?? fake.user();
	const guild = actor.dm
		? {}
		: {
				guild_id: actor.guildId ?? "test-guild",
				guild_locale: actor.guildLocale ?? "en-US",
				member: {
					user,
					roles: [...(actor.roles ?? [])],
					permissions: String(actor.permissions ?? 0n),
					joined_at: new Date(0).toISOString(),
					deaf: false,
					mute: false,
					flags: 0,
				},
			};
	return {
		id: fakeId(),
		application_id: "test-app",
		token: "test-token",
		version: 1,
		type,
		channel_id: actor.channelId ?? "test-channel",
		app_permissions: String(actor.appPermissions ?? 0n),
		locale: actor.locale ?? "en-US",
		...(actor.dm ? { user } : guild),
		...(actor.invoker
			? {
					message: {
						id: fakeId(),
						interaction_metadata: {
							id: fakeId(),
							type: InteractionType.ApplicationCommand,
							user: actor.invoker,
						},
					},
				}
			: {}),
	};
}

async function finish(
	recording: Recording,
	result: { status: string; error?: unknown },
): Promise<TestResult> {
	const first = recording.messages[0];
	return {
		...recording,
		status: result.status,
		...("error" in result ? { error: result.error } : {}),
		ephemeral: ((first?.flags ?? 0) & EPHEMERAL) === EPHEMERAL,
	};
}

const defaults: Options = { autoDeferMs: false };

// ------------------------------------------------------------------ commands

type RequiredKeys<T extends OptionMap> = {
	[K in keyof T]: T[K]["required"] extends true ? K : never;
}[keyof T];

/** The options to run a command with: required ones required, values as handlers see them. */
export type TestOptions<T extends OptionMap> = {
	[K in RequiredKeys<T>]: NonNullable<OptionValue<T[K]>>;
} & {
	[K in Exclude<keyof T, RequiredKeys<T>>]?: OptionValue<T[K]>;
};

const OPTION_TYPES = {
	string: ApplicationCommandOptionType.String,
	integer: ApplicationCommandOptionType.Integer,
	number: ApplicationCommandOptionType.Number,
	boolean: ApplicationCommandOptionType.Boolean,
	user: ApplicationCommandOptionType.User,
	channel: ApplicationCommandOptionType.Channel,
	role: ApplicationCommandOptionType.Role,
} as const;

export interface CommandTester<T extends OptionMap> {
	/** Runs as this user, member or DM. */
	as(actor: Actor): CommandTester<T>;
	/** Bot-wide guards, middleware or timing, as dispatch takes them. */
	with(options: Options): CommandTester<T>;
	run(
		// Optional whenever nothing is required, not only when there are no options.
		...args: [RequiredKeys<T>] extends [never]
			? [options?: TestOptions<T>]
			: [options: TestOptions<T>]
	): Promise<TestResult>;
}

/**
 * Runs a command the way Discord would, without Discord:
 *
 *     const result = await testCommand(ban)
 *       .as({ permissions: PermissionFlagsBits.BanMembers })
 *       .run({ user: fake.user("alice") });
 *     expect(result.replies).toEqual(["Banned alice"]);
 */
export function testCommand<T extends OptionMap>(
	definition: CommandDefinition<T>,
	actor: Actor = {},
	options: Options = defaults,
): CommandTester<T> {
	return {
		as: (next) => testCommand(definition, { ...actor, ...next }, options),
		with: (next) => testCommand(definition, actor, { ...options, ...next }),
		async run(values?: TestOptions<T>) {
			const given: APIApplicationCommandInteractionDataOption[] = [];
			const resolved = {
				users: {} as Record<string, APIUser>,
				roles: {} as Record<string, APIRole>,
				channels: {} as Record<string, APIInteractionDataResolvedChannel>,
			};
			for (const [name, value] of Object.entries(values ?? {})) {
				if (value === undefined) continue;
				const definitionOf = definition.options[name];
				if (!definitionOf)
					throw new Error(`The command has no option "${name}".`);
				const kind = definitionOf.kind;
				let sent: unknown = value;
				if (kind === "user" || kind === "role" || kind === "channel") {
					const entity = value as { id: string };
					resolved[`${kind}s`][entity.id] = value as never;
					sent = entity.id;
				}
				given.push({ type: OPTION_TYPES[kind], name, value: sent } as never);
			}

			const interaction = {
				...interactionBase(actor, InteractionType.ApplicationCommand),
				data: {
					id: fakeId(),
					type: ApplicationCommandType.ChatInput,
					name: "test",
					options: given,
					resolved,
				},
			};
			const recording = recordingTransport();
			const result = await dispatch(
				buildCommandTree([{ path: ["test"], definition: definition as never }]),
				interaction as never,
				recording.transport,
				options,
			);
			return finish(recording, result);
		},
	};
}

// ---------------------------------------------------------------- components

type Callable = (...args: unknown[]) => { custom_id: string };

const COMPONENT_TYPES: Record<string, ComponentType> = {
	button: ComponentType.Button,
	"string-select": ComponentType.StringSelect,
	"user-select": ComponentType.UserSelect,
	"role-select": ComponentType.RoleSelect,
	"mentionable-select": ComponentType.MentionableSelect,
	"channel-select": ComponentType.ChannelSelect,
};

/** For entity selects: the picked users, roles or channels. */
type Picked = string | APIUser | APIRole | APIInteractionDataResolvedChannel;

export interface ComponentTester {
	as(actor: Actor): ComponentTester;
	with(options: Options): ComponentTester;
	/** Clicks a button rendered with `state` (leave it out for buttons without state). */
	click(state?: unknown): Promise<TestResult>;
	/**
	 * Picks from a select: values for string selects, or users, roles and
	 * channels (fake ones work) for the others.
	 */
	select(values: readonly Picked[], state?: unknown): Promise<TestResult>;
	/** Sends a custom_id as-is, e.g. to test what tampered state does. */
	send(customId: string, values?: readonly string[]): Promise<TestResult>;
}

/** Clicks buttons and picks from selects the way Discord would, without Discord. */
export function testComponent(
	definition: ComponentDefinition,
	actor: Actor = {},
	options: Options = defaults,
): ComponentTester {
	const kind = (definition as unknown as { kind: string }).kind;
	const componentType = COMPONENT_TYPES[kind];
	if (componentType === undefined) {
		throw new Error(
			`testComponent can't run a ${kind}; use testModal for modals.`,
		);
	}
	const customIdFor = (state: unknown) =>
		(definition as unknown as Callable)(...(state === undefined ? [] : [state]))
			.custom_id;

	const send = async (
		customId: string,
		values?: readonly string[],
		resolved?: object,
	) => {
		const interaction = {
			...interactionBase(actor, InteractionType.MessageComponent),
			data: {
				custom_id: customId,
				component_type: componentType,
				...(values ? { values: [...values] } : {}),
				...(resolved ? { resolved } : {}),
			},
		};
		const recording = recordingTransport();
		const result = await dispatchComponent(
			createComponentRegistry([definition]),
			interaction as never,
			recording.transport,
			options,
		);
		return finish(recording, result);
	};

	return {
		as: (next) => testComponent(definition, { ...actor, ...next }, options),
		with: (next) => testComponent(definition, actor, { ...options, ...next }),
		click: (state) => send(customIdFor(state)),
		send: (customId, values) => send(customId, values),
		select(values, state) {
			const resolved = {
				users: {} as Record<string, unknown>,
				roles: {} as Record<string, unknown>,
				channels: {} as Record<string, unknown>,
			};
			const ids = values.map((value) => {
				if (typeof value === "string") return value;
				const bucket =
					"username" in value
						? "users"
						: "color" in value
							? "roles"
							: "channels";
				resolved[bucket][value.id] = value;
				return value.id;
			});
			return send(
				customIdFor(state),
				ids,
				componentType === ComponentType.StringSelect ? undefined : resolved,
			);
		},
	};
}

// -------------------------------------------------------------------- modals

export interface ModalTester<F extends FieldMap> {
	as(actor: Actor): ModalTester<F>;
	with(options: Options): ModalTester<F>;
	/** Submits the form with these values (and the state it was opened with). */
	submit(
		values: { readonly [K in keyof F]?: string },
		state?: unknown,
	): Promise<TestResult>;
}

/** Submits a modal the way Discord would, without Discord. */
export function testModal<F extends FieldMap>(
	definition: ModalDefinition<F, never>,
	actor: Actor = {},
	options: Options = defaults,
): ModalTester<F> {
	return {
		as: (next) => testModal(definition, { ...actor, ...next }, options),
		with: (next) => testModal(definition, actor, { ...options, ...next }),
		async submit(values, state) {
			const customId = (definition as unknown as Callable)(
				...(state === undefined ? [] : [state]),
			).custom_id;
			const interaction = {
				...interactionBase(actor, InteractionType.ModalSubmit),
				data: {
					custom_id: customId,
					components: Object.entries(values).map(([name, value]) => ({
						type: ComponentType.Label,
						id: 1,
						component: {
							type: ComponentType.TextInput,
							id: 2,
							custom_id: name,
							value,
						},
					})),
				},
			};
			const recording = recordingTransport();
			const result = await dispatchModal(
				createComponentRegistry([definition]),
				interaction as never,
				recording.transport,
				options,
			);
			return finish(recording, result);
		},
	};
}

// --------------------------------------------------------------------- menus

export interface MenuTester {
	as(actor: Actor): MenuTester;
	with(options: Options): MenuTester;
	/** Right-clicks this user (user menus) or message (message menus). */
	run(target: APIUser | ReturnType<typeof fake.message>): Promise<TestResult>;
}

/** Runs a right-click command the way Discord would, without Discord. */
export function testMenu(
	definition: MenuDefinition,
	actor: Actor = {},
	options: Options = defaults,
): MenuTester {
	return {
		as: (next) => testMenu(definition, { ...actor, ...next }, options),
		with: (next) => testMenu(definition, actor, { ...options, ...next }),
		async run(target) {
			const isUser = definition.kind === "user";
			const interaction = {
				...interactionBase(actor, InteractionType.ApplicationCommand),
				data: {
					id: fakeId(),
					type: isUser
						? ApplicationCommandType.User
						: ApplicationCommandType.Message,
					name: definition.name,
					target_id: target.id,
					resolved: isUser
						? { users: { [target.id]: target } }
						: { messages: { [target.id]: target } },
				},
			};
			const recording = recordingTransport();
			const result = await dispatchMenu(
				[definition],
				interaction as never,
				recording.transport,
				options,
			);
			return finish(recording, result);
		},
	};
}
