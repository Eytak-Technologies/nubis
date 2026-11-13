import {
	type APIButtonComponentWithCustomId,
	type APIButtonComponentWithURL,
	type APIChannelSelectComponent,
	type APIInteractionDataResolvedChannel,
	type APIInteractionDataResolvedGuildMember,
	type APIMentionableSelectComponent,
	type APIMessageComponentEmoji,
	type APIMessageComponentInteraction,
	type APIModalInteractionResponseCallbackData,
	type APIModalSubmitInteraction,
	type APIRole,
	type APIRoleSelectComponent,
	type APIStringSelectComponent,
	type APIUser,
	type APIUserSelectComponent,
	ButtonStyle,
	type ChannelType,
	ComponentType,
	InteractionType,
	SelectMenuDefaultValueType,
} from "discord-api-types/v10";
import type { NubisApi } from "./api";
import { assertValidComponentId, renderCustomId } from "./custom-id";
import { NubisError } from "./errors";
import type { Guard } from "./guard";
import type { Middleware } from "./middleware";
import type { ReplyInput } from "./reply";
import type { SchemaInput, SchemaOutput, StandardSchemaV1 } from "./schema";
import type { StateStore } from "./store";

export type AnySchema = StandardSchemaV1<unknown, unknown>;

/** A rendered modal, ready for `showModal()`. */
export type ModalData = APIModalInteractionResponseCallbackData;

/** State inside handlers: the schema's output, or `undefined` without one. */
export type ComponentState<S> = [S] extends [undefined]
	? undefined
	: SchemaOutput<S>;

/** Arguments for rendering: state first when the component has a schema. */
export type RenderArgs<S, O> = [S] extends [undefined]
	? [overrides?: O]
	: [state: SchemaInput<S>, overrides?: O];

export interface ComponentContext<State> {
	readonly state: State;
	/** The raw interaction from Discord, for anything Nubis doesn't cover yet. */
	readonly interaction: APIMessageComponentInteraction;
	/** Discord's API: act on what was clicked. */
	readonly api: NubisApi;
	/** Sends a new message. */
	reply(message: ReplyInput): Promise<void>;
	/** Edits the message the component is on. Call it before reply(). */
	update(message: ReplyInput): Promise<void>;
	/** Edits the first reply. */
	editReply(message: ReplyInput): Promise<void>;
	/** Shows "thinking…" and a reply to come. */
	defer(options?: { readonly ephemeral?: boolean }): Promise<void>;
	/**
	 * Acknowledges the click without a message; update() can still edit later.
	 * Nubis does this on its own after two seconds.
	 */
	deferUpdate(): Promise<void>;
	/** Opens a modal. Must be the first response, so call it before reply(). */
	showModal(modal: ModalData): Promise<void>;
}

/** The parts of a handler context that don't depend on the interaction type. */
export interface HandlerBase {
	readonly state: unknown;
	readonly api: NubisApi;
	reply(message: ReplyInput): Promise<void>;
	update(message: ReplyInput): Promise<void>;
	editReply(message: ReplyInput): Promise<void>;
	defer(options?: { readonly ephemeral?: boolean }): Promise<void>;
	deferUpdate(): Promise<void>;
	showModal(modal: ModalData): Promise<void>;
}

export type ComponentKind =
	| "button"
	| "string-select"
	| "user-select"
	| "role-select"
	| "channel-select"
	| "mentionable-select"
	| "modal";

/** What dispatch needs from any component or modal, whatever its state type. */
export interface ComponentRuntime {
	readonly kind: ComponentKind;
	readonly id: string;
	readonly schema: AnySchema | undefined;
	/** Where state lives when it's kept outside the custom_id. */
	readonly store: StateStore | undefined;
	readonly guards: readonly Guard[];
	readonly middleware: readonly Middleware[];
	/** Returns false when the interaction doesn't fit (a stale message or form). */
	handle(
		base: HandlerBase,
		interaction: APIMessageComponentInteraction | APIModalSubmitInteraction,
	): Promise<boolean>;
}

export const RUNTIME = "~nubis";

export interface WithRuntime {
	readonly id: string;
	readonly [RUNTIME]: ComponentRuntime;
}

function isMessageComponent(
	interaction: APIMessageComponentInteraction | APIModalSubmitInteraction,
): interaction is APIMessageComponentInteraction {
	return interaction.type === InteractionType.MessageComponent;
}

/** Settings every interactive component shares. */
interface InteractiveConfig<S extends AnySchema | undefined> {
	/** Routes clicks to this component. Changing it makes ones already sent stop working. */
	readonly id: string;
	/** Validates the state that comes back with each interaction. */
	readonly state?: S;
	/**
	 * Keeps state here instead of in the custom_id, for state over Discord's
	 * 100 characters. The custom_id then only carries a key.
	 */
	readonly store?: StateStore;
	/**
	 * Checks before the handler. Anyone who can see a message can click its
	 * components, so use `invokerOnly` or a permission guard for anything that
	 * acts on someone's behalf.
	 */
	readonly guards?: readonly Guard[];
	readonly middleware?: readonly Middleware[];
}

function splitArgs<O>(
	hasState: boolean,
	args: unknown[],
): [unknown, O | undefined] {
	return (hasState ? args : [undefined, args[0]]) as [unknown, O | undefined];
}

// ------------------------------------------------------------------- emoji

/** "🔥", "<:party:123>", "<a:dance:456>", or Discord's emoji object. */
export type EmojiInput = string | APIMessageComponentEmoji;

const CUSTOM_EMOJI = /^<(a?):(\w{2,32}):(\d{17,20})>$/;

export function toEmoji(input: EmojiInput): APIMessageComponentEmoji {
	if (typeof input !== "string") return input;
	const custom = CUSTOM_EMOJI.exec(input);
	if (custom) {
		const [, animated, name, id] = custom;
		return { id, name, ...(animated ? { animated: true } : {}) };
	}
	return { name: input };
}

// ------------------------------------------------------------------ button

const BUTTON_STYLES = {
	primary: ButtonStyle.Primary,
	secondary: ButtonStyle.Secondary,
	success: ButtonStyle.Success,
	danger: ButtonStyle.Danger,
} as const;

export type ButtonStyleName = keyof typeof BUTTON_STYLES;

// Discord's limit for button labels.
const MAX_LABEL = 80;

function checkLabel(label: string | undefined, where: string): void {
	if (label !== undefined && label.length > MAX_LABEL) {
		throw new NubisError(
			`${where}: button labels can be at most ${MAX_LABEL} characters (got ${label.length}).`,
		);
	}
}

export interface ButtonOverrides {
	readonly label?: string;
	readonly style?: ButtonStyleName;
	readonly emoji?: EmojiInput;
	readonly disabled?: boolean;
}

export interface ButtonConfig<
	S extends AnySchema | undefined,
> extends InteractiveConfig<S> {
	readonly label: string;
	readonly style?: ButtonStyleName;
	readonly emoji?: EmojiInput;
	onClick(context: ComponentContext<ComponentState<S>>): unknown;
}

export interface ButtonDefinition<
	S extends AnySchema | undefined,
> extends WithRuntime {
	(...args: RenderArgs<S, ButtonOverrides>): APIButtonComponentWithCustomId;
	readonly kind: "button";
}

export function button<S extends AnySchema | undefined = undefined>(
	config: ButtonConfig<S>,
): ButtonDefinition<S> {
	assertValidComponentId(config.id);
	checkLabel(config.label, `Button "${config.id}"`);
	const hasState = config.state !== undefined;

	const render = (...args: unknown[]): APIButtonComponentWithCustomId => {
		const [state, overrides] = splitArgs<ButtonOverrides>(hasState, args);
		const label = overrides?.label ?? config.label;
		checkLabel(label, `Button "${config.id}"`);
		const emoji = overrides?.emoji ?? config.emoji;
		return {
			type: ComponentType.Button,
			custom_id: renderCustomId(config.id, state, config.store),
			label,
			style: BUTTON_STYLES[overrides?.style ?? config.style ?? "secondary"],
			...(emoji ? { emoji: toEmoji(emoji) } : {}),
			...(overrides?.disabled ? { disabled: true } : {}),
		};
	};

	const runtime: ComponentRuntime = {
		kind: "button",
		id: config.id,
		schema: config.state,
		store: config.store,
		guards: config.guards ?? [],
		middleware: config.middleware ?? [],
		async handle(base, interaction) {
			if (
				!isMessageComponent(interaction) ||
				interaction.data.component_type !== ComponentType.Button
			) {
				return false;
			}
			await config.onClick({
				...base,
				interaction,
			} as ComponentContext<ComponentState<S>>);
			return true;
		},
	};

	return Object.assign(render, {
		id: config.id,
		kind: "button" as const,
		[RUNTIME]: runtime,
	}) as unknown as ButtonDefinition<S>;
}

export interface LinkButtonConfig {
	readonly url: string;
	readonly label?: string;
	readonly emoji?: EmojiInput;
	readonly disabled?: boolean;
}

/**
 * A button that opens a URL. It has no handler: Discord opens the link
 * without telling the bot, so it needs no id and no registration.
 */
export function linkButton(
	config: LinkButtonConfig,
): APIButtonComponentWithURL {
	if (!/^(https?|discord):\/\//.test(config.url)) {
		throw new NubisError(
			`Link button "${config.label ?? config.url}": the URL must start with https://, http:// or discord://.`,
		);
	}
	if (!config.label && !config.emoji) {
		throw new NubisError("Link buttons need a label, an emoji, or both.");
	}
	checkLabel(config.label, `Link button "${config.label}"`);
	return {
		type: ComponentType.Button,
		style: ButtonStyle.Link,
		url: config.url,
		...(config.label ? { label: config.label } : {}),
		...(config.emoji ? { emoji: toEmoji(config.emoji) } : {}),
		...(config.disabled ? { disabled: true } : {}),
	};
}

// ----------------------------------------------------------- string select

export interface SelectOption<V extends string = string> {
	readonly label: string;
	readonly value: V;
	readonly description?: string;
	readonly emoji?: EmojiInput;
	readonly default?: boolean;
}

export interface StringSelectOverrides {
	readonly placeholder?: string;
	readonly disabled?: boolean;
}

export interface StringSelectConfig<
	O extends readonly SelectOption[],
	S extends AnySchema | undefined,
> extends InteractiveConfig<S> {
	readonly options: O;
	readonly placeholder?: string;
	readonly minValues?: number;
	readonly maxValues?: number;
	onSelect(
		context: ComponentContext<ComponentState<S>> & {
			/** The chosen values, typed from `options`. */
			readonly values: O[number]["value"][];
		},
	): unknown;
}

export interface StringSelectDefinition<
	O extends readonly SelectOption[],
	S extends AnySchema | undefined,
> extends WithRuntime {
	(...args: RenderArgs<S, StringSelectOverrides>): APIStringSelectComponent;
	readonly kind: "string-select";
	readonly options: O;
}

// Discord's limits for select menus.
const MAX_SELECT_OPTIONS = 25;
const MAX_SELECTED = 25;

function checkValueCounts(
	where: string,
	minValues: number | undefined,
	maxValues: number | undefined,
	available = MAX_SELECTED,
): void {
	const min = minValues ?? 1;
	const max = maxValues ?? 1;
	if (min < 0 || max < 1 || min > max || max > available) {
		throw new NubisError(
			`${where}: minValues and maxValues must satisfy 0 <= min <= max <= ${available} (got ${min} and ${max}).`,
		);
	}
}

const valueCountFields = (minValues?: number, maxValues?: number) => ({
	...(minValues === undefined ? {} : { min_values: minValues }),
	...(maxValues === undefined ? {} : { max_values: maxValues }),
});

export function stringSelect<
	const O extends readonly SelectOption[],
	S extends AnySchema | undefined = undefined,
>(config: StringSelectConfig<O, S>): StringSelectDefinition<O, S> {
	assertValidComponentId(config.id);
	const where = `Select "${config.id}"`;
	if (config.options.length < 1 || config.options.length > MAX_SELECT_OPTIONS) {
		throw new NubisError(
			`${where}: needs 1-${MAX_SELECT_OPTIONS} options (got ${config.options.length}).`,
		);
	}
	const allowed = new Set(config.options.map((option) => option.value));
	if (allowed.size !== config.options.length) {
		throw new NubisError(`${where}: option values must be unique.`);
	}
	checkValueCounts(
		where,
		config.minValues,
		config.maxValues,
		config.options.length,
	);
	const hasState = config.state !== undefined;

	const render = (...args: unknown[]): APIStringSelectComponent => {
		const [state, overrides] = splitArgs<StringSelectOverrides>(hasState, args);
		const placeholder = overrides?.placeholder ?? config.placeholder;
		return {
			type: ComponentType.StringSelect,
			custom_id: renderCustomId(config.id, state, config.store),
			options: config.options.map(({ emoji, ...option }) => ({
				...option,
				...(emoji ? { emoji: toEmoji(emoji) } : {}),
			})),
			...(placeholder ? { placeholder } : {}),
			...valueCountFields(config.minValues, config.maxValues),
			...(overrides?.disabled ? { disabled: true } : {}),
		};
	};

	const runtime: ComponentRuntime = {
		kind: "string-select",
		id: config.id,
		schema: config.state,
		store: config.store,
		guards: config.guards ?? [],
		middleware: config.middleware ?? [],
		async handle(base, interaction) {
			if (!isMessageComponent(interaction)) return false;
			const data = interaction.data;
			if (data.component_type !== ComponentType.StringSelect) return false;
			// Values outside the options mean the message predates a change to them.
			if (!data.values.every((value) => allowed.has(value))) return false;
			await config.onSelect({
				...({ ...base, interaction } as ComponentContext<ComponentState<S>>),
				values: data.values as O[number]["value"][],
			});
			return true;
		},
	};

	return Object.assign(render, {
		id: config.id,
		kind: "string-select" as const,
		options: config.options,
		[RUNTIME]: runtime,
	}) as unknown as StringSelectDefinition<O, S>;
}

// ------------------------------------------- user, role, channel, mentionable

/** What each select hands its handler: Discord's resolved objects, not bare ids. */
export interface UserSelection {
	readonly users: APIUser[];
	/** Server memberships by user id, when used in a server. */
	readonly members: Readonly<
		Record<string, APIInteractionDataResolvedGuildMember | undefined>
	>;
}
export interface RoleSelection {
	readonly roles: APIRole[];
}
export interface ChannelSelection {
	readonly channels: APIInteractionDataResolvedChannel[];
}
export interface MentionableSelection {
	readonly users: APIUser[];
	readonly roles: APIRole[];
}

interface EntitySelectOverrides {
	readonly placeholder?: string;
	readonly disabled?: boolean;
}

export interface UserSelectOverrides extends EntitySelectOverrides {
	/** Users selected when the menu appears. */
	readonly defaultUsers?: readonly string[];
}
export interface RoleSelectOverrides extends EntitySelectOverrides {
	readonly defaultRoles?: readonly string[];
}
export interface ChannelSelectOverrides extends EntitySelectOverrides {
	readonly defaultChannels?: readonly string[];
}
export interface MentionableSelectOverrides extends EntitySelectOverrides {
	readonly defaultUsers?: readonly string[];
	readonly defaultRoles?: readonly string[];
}

interface EntitySelectConfig<
	S extends AnySchema | undefined,
	Selection,
> extends InteractiveConfig<S> {
	readonly placeholder?: string;
	readonly minValues?: number;
	readonly maxValues?: number;
	onSelect(context: ComponentContext<ComponentState<S>> & Selection): unknown;
}

export type UserSelectConfig<S extends AnySchema | undefined> =
	EntitySelectConfig<S, UserSelection>;
export type RoleSelectConfig<S extends AnySchema | undefined> =
	EntitySelectConfig<S, RoleSelection>;
export type MentionableSelectConfig<S extends AnySchema | undefined> =
	EntitySelectConfig<S, MentionableSelection>;
export interface ChannelSelectConfig<
	S extends AnySchema | undefined,
> extends EntitySelectConfig<S, ChannelSelection> {
	/** Only these channel types can be picked. */
	readonly channelTypes?: readonly ChannelType[];
}

export interface EntitySelectDefinition<
	S extends AnySchema | undefined,
	Overrides,
	Rendered,
	Kind extends ComponentKind,
> extends WithRuntime {
	(...args: RenderArgs<S, Overrides>): Rendered;
	readonly kind: Kind;
}

type Resolved = NonNullable<
	Extract<
		APIMessageComponentInteraction["data"],
		{ component_type: ComponentType.MentionableSelect }
	>["resolved"]
> & {
	readonly channels?: Record<string, APIInteractionDataResolvedChannel>;
};

interface EntitySpec<Selection, Overrides> {
	readonly kind: ComponentKind;
	readonly componentType:
		| ComponentType.UserSelect
		| ComponentType.RoleSelect
		| ComponentType.ChannelSelect
		| ComponentType.MentionableSelect;
	readonly defaults: (
		overrides: Overrides | undefined,
	) => { id: string; type: SelectMenuDefaultValueType }[];
	/** Turns selected ids into resolved objects; undefined when Discord left one out. */
	readonly resolve: (
		values: readonly string[],
		resolved: Resolved,
	) => Selection | undefined;
}

function entitySelect<
	S extends AnySchema | undefined,
	Selection,
	Overrides extends EntitySelectOverrides,
>(
	spec: EntitySpec<Selection, Overrides>,
	config: EntitySelectConfig<S, Selection> & {
		readonly channelTypes?: readonly ChannelType[];
	},
) {
	assertValidComponentId(config.id);
	checkValueCounts(`Select "${config.id}"`, config.minValues, config.maxValues);
	if (config.channelTypes?.length === 0) {
		throw new NubisError(
			`Select "${config.id}": channelTypes needs at least one type; leave it out to allow all.`,
		);
	}
	const hasState = config.state !== undefined;

	const render = (...args: unknown[]) => {
		const [state, overrides] = splitArgs<Overrides>(hasState, args);
		const placeholder = overrides?.placeholder ?? config.placeholder;
		const defaults = spec.defaults(overrides);
		return {
			type: spec.componentType,
			custom_id: renderCustomId(config.id, state, config.store),
			...(placeholder ? { placeholder } : {}),
			...valueCountFields(config.minValues, config.maxValues),
			...(config.channelTypes
				? { channel_types: [...config.channelTypes] }
				: {}),
			...(defaults.length > 0 ? { default_values: defaults } : {}),
			...(overrides?.disabled ? { disabled: true } : {}),
		};
	};

	const runtime: ComponentRuntime = {
		kind: spec.kind,
		id: config.id,
		schema: config.state,
		store: config.store,
		guards: config.guards ?? [],
		middleware: config.middleware ?? [],
		async handle(base, interaction) {
			if (!isMessageComponent(interaction)) return false;
			const data = interaction.data;
			if (data.component_type !== spec.componentType) return false;
			const selection = spec.resolve(
				data.values,
				("resolved" in data ? data.resolved : {}) as Resolved,
			);
			if (!selection) return false;
			await config.onSelect({
				...({ ...base, interaction } as ComponentContext<ComponentState<S>>),
				...selection,
			});
			return true;
		},
	};

	return Object.assign(render, {
		id: config.id,
		kind: spec.kind,
		[RUNTIME]: runtime,
	});
}

const pick = <T>(
	ids: readonly string[],
	from: Record<string, T> | undefined,
): T[] | undefined => {
	const found = ids.map((id) => from?.[id]);
	return found.every((item) => item !== undefined) ? (found as T[]) : undefined;
};

const asDefaults = (
	ids: readonly string[] | undefined,
	type: SelectMenuDefaultValueType,
) => (ids ?? []).map((id) => ({ id, type }));

/** Pick server members or users. The handler gets their user objects and memberships. */
export function userSelect<S extends AnySchema | undefined = undefined>(
	config: UserSelectConfig<S>,
): EntitySelectDefinition<
	S,
	UserSelectOverrides,
	APIUserSelectComponent,
	"user-select"
> {
	return entitySelect<S, UserSelection, UserSelectOverrides>(
		{
			kind: "user-select",
			componentType: ComponentType.UserSelect,
			defaults: (o) =>
				asDefaults(o?.defaultUsers, SelectMenuDefaultValueType.User),
			resolve: (values, resolved) => {
				const users = pick(values, resolved.users);
				if (!users) return undefined;
				const members = Object.fromEntries(
					values.map((id) => [id, resolved.members?.[id]]),
				);
				return { users, members };
			},
		},
		config,
	) as never;
}

/** Pick roles. */
export function roleSelect<S extends AnySchema | undefined = undefined>(
	config: RoleSelectConfig<S>,
): EntitySelectDefinition<
	S,
	RoleSelectOverrides,
	APIRoleSelectComponent,
	"role-select"
> {
	return entitySelect<S, RoleSelection, RoleSelectOverrides>(
		{
			kind: "role-select",
			componentType: ComponentType.RoleSelect,
			defaults: (o) =>
				asDefaults(o?.defaultRoles, SelectMenuDefaultValueType.Role),
			resolve: (values, resolved) => {
				const roles = pick(values, resolved.roles);
				return roles ? { roles } : undefined;
			},
		},
		config,
	) as never;
}

/** Pick channels, optionally of certain types. */
export function channelSelect<S extends AnySchema | undefined = undefined>(
	config: ChannelSelectConfig<S>,
): EntitySelectDefinition<
	S,
	ChannelSelectOverrides,
	APIChannelSelectComponent,
	"channel-select"
> {
	return entitySelect<S, ChannelSelection, ChannelSelectOverrides>(
		{
			kind: "channel-select",
			componentType: ComponentType.ChannelSelect,
			defaults: (o) =>
				asDefaults(o?.defaultChannels, SelectMenuDefaultValueType.Channel),
			resolve: (values, resolved) => {
				const channels = pick(values, resolved.channels);
				return channels ? { channels } : undefined;
			},
		},
		config,
	) as never;
}

/** Pick users and roles in one menu. */
export function mentionableSelect<S extends AnySchema | undefined = undefined>(
	config: MentionableSelectConfig<S>,
): EntitySelectDefinition<
	S,
	MentionableSelectOverrides,
	APIMentionableSelectComponent,
	"mentionable-select"
> {
	return entitySelect<S, MentionableSelection, MentionableSelectOverrides>(
		{
			kind: "mentionable-select",
			componentType: ComponentType.MentionableSelect,
			defaults: (o) => [
				...asDefaults(o?.defaultUsers, SelectMenuDefaultValueType.User),
				...asDefaults(o?.defaultRoles, SelectMenuDefaultValueType.Role),
			],
			resolve: (values, resolved) => {
				const users: APIUser[] = [];
				const roles: APIRole[] = [];
				for (const id of values) {
					const user = resolved.users?.[id];
					const role = resolved.roles?.[id];
					if (user) users.push(user);
					else if (role) roles.push(role);
					else return undefined;
				}
				return { users, roles };
			},
		},
		config,
	) as never;
}

export type ComponentDefinition = WithRuntime;
