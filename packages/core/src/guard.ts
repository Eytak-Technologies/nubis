import type {
	APIChatInputApplicationCommandInteraction,
	APIInteractionGuildMember,
	APIMessageComponentInteraction,
	APIModalSubmitInteraction,
	APIUser,
} from "discord-api-types/v10";

export type GuardedInteraction =
	| APIChatInputApplicationCommandInteraction
	| APIMessageComponentInteraction
	| APIModalSubmitInteraction;

const DENIAL = Symbol("nubis.denial");

/** Returned by `deny()`; tells Nubis to stop and answer with `message`. */
export interface Denial {
	readonly [DENIAL]: true;
	readonly message: string;
}

export interface GuardContext {
	readonly interaction: GuardedInteraction;
	/** Who used the command or component, in a server or in DMs. */
	readonly user: APIUser;
	/** The member, in a server; `undefined` in DMs. */
	readonly member: APIInteractionGuildMember | undefined;
	readonly guildId: string | undefined;
	readonly channelId: string | undefined;
	/** Stops here. The user sees `message`, only to them. */
	deny(message: string): Denial;
}

export type GuardResult = Denial | undefined | void;

/** A check that runs before a handler. Return `deny(...)` to stop, anything else to go on. */
export type Guard = (
	context: GuardContext,
) => GuardResult | Promise<GuardResult>;

/** Defines a guard. An identity function, for types and readability. */
export function guard(check: Guard): Guard {
	return check;
}

export function isDenial(value: unknown): value is Denial {
	return typeof value === "object" && value !== null && DENIAL in value;
}

export function guardContext(interaction: GuardedInteraction): GuardContext {
	const member = interaction.member;
	const user = member?.user ?? interaction.user;
	if (!user) throw new Error("Discord sent an interaction without a user.");
	return {
		interaction,
		user,
		member,
		guildId: interaction.guild_id,
		channelId: interaction.channel?.id ?? interaction.channel_id,
		deny: (message) => ({ [DENIAL]: true, message }),
	};
}

/** Runs guards in order and returns the first denial, if any. */
export async function runGuards(
	guards: readonly Guard[],
	context: GuardContext,
): Promise<Denial | undefined> {
	for (const check of guards) {
		const result = await check(context);
		if (isDenial(result)) return result;
	}
	return undefined;
}

// ---------------------------------------------------------------- built-ins

const has = (bitfield: string | undefined, permissions: readonly bigint[]) => {
	if (bitfield === undefined) return false;
	const granted = BigInt(bitfield);
	return permissions.every(
		(permission) => (granted & permission) === permission,
	);
};

/** Only in servers, not in DMs. */
export const guildOnly: Guard = ({ guildId, deny }) =>
	guildId ? undefined : deny("This only works in a server.");

/**
 * The member needs every one of these permissions (`PermissionFlagsBits` from
 * discord-api-types). Unlike `defaultMemberPermissions`, server admins can't
 * override this: it's checked when the command runs.
 */
export function hasPermission(...permissions: bigint[]): Guard {
	return ({ member, deny }) =>
		has(member?.permissions, permissions)
			? undefined
			: deny("You don't have permission to do that.");
}

/** The bot needs these permissions in the channel, e.g. BanMembers before banning. */
export function botHasPermission(...permissions: bigint[]): Guard {
	return ({ interaction, deny }) =>
		has(interaction.app_permissions, permissions)
			? undefined
			: deny("I don't have the permissions I need for that here.");
}

/** The member needs at least one of these roles. Pass ids, or a function that reads them (e.g. from config). */
export function hasRole(
	...roles: (string | (() => string | undefined))[]
): Guard {
	return ({ member, deny }) => {
		const ids = roles.map((role) =>
			typeof role === "function" ? role() : role,
		);
		return member?.roles.some((role) => ids.includes(role))
			? undefined
			: deny("You don't have the role for that.");
	};
}

/**
 * For components: only the person who ran the command that sent the message
 * can use it. Without this, anyone who can see a public message can click it.
 */
export const invokerOnly: Guard = ({ interaction, user, deny }) => {
	if (!("message" in interaction) || !interaction.message) return undefined;
	const invoker = interaction.message.interaction_metadata?.user.id;
	return invoker === undefined || invoker === user.id
		? undefined
		: deny("Only the person who used the command can do that.");
};

export interface CooldownOptions {
	readonly seconds: number;
	/** Whose uses count together. Defaults to "user". */
	readonly per?: "user" | "member" | "channel" | "guild" | "global";
	/** Milliseconds since the epoch. Swappable in tests. */
	readonly now?: () => number;
}

/**
 * Allows one use per `seconds`. Uses are counted when this guard passes, so
 * put it after other guards: a denied permission check shouldn't use up a turn.
 * Kept in memory, per process.
 */
export function cooldown(options: CooldownOptions): Guard {
	const { seconds, per = "user", now = Date.now } = options;
	const lastUse = new Map<string, number>();
	const ms = seconds * 1000;

	return ({ user, guildId, channelId, deny }) => {
		const key = {
			user: user.id,
			member: `${guildId}:${user.id}`,
			channel: channelId ?? "dm",
			guild: guildId ?? `dm:${user.id}`,
			global: "global",
		}[per];
		const time = now();
		const last = lastUse.get(key);
		if (last !== undefined && time - last < ms) {
			const ready = Math.ceil((last + ms) / 1000);
			// Discord renders this as a live relative time, like "in 12 seconds".
			return deny(`Slow down! You can do that again <t:${ready}:R>.`);
		}
		lastUse.set(key, time);
		// Drop expired entries now and then so the map doesn't grow forever.
		if (lastUse.size > 10_000) {
			for (const [k, t] of lastUse) if (time - t >= ms) lastUse.delete(k);
		}
		return undefined;
	};
}
