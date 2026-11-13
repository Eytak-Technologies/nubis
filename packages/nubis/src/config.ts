import type { ErrorHandler, Guard, Middleware } from "@nubisjs/core";
import {
	ActivityType,
	GatewayIntentBits,
	type GatewayPresenceUpdateData,
	PresenceUpdateStatus,
} from "discord-api-types/v10";

export type IntentName = Exclude<
	keyof typeof GatewayIntentBits,
	"GuildBans" | "GuildEmojisAndStickers"
>;

export interface PresenceConfig {
	readonly status?: "online" | "idle" | "dnd" | "invisible";
	/** What the member list shows under the bot's name. */
	readonly activity?: {
		readonly type:
			"playing" | "listening" | "watching" | "competing" | "custom";
		/** For "custom", the status text itself. */
		readonly name: string;
	};
}

/** Settings for the whole bot, in `nubis.config.ts` next to its folders. */
export interface NubisConfig {
	/** Where commands/, components/, menus/ and events/ live, relative to the config. */
	readonly root?: string;
	/** Intents beyond what the bot's events need, e.g. ["MessageContent"]. */
	readonly intents?: readonly IntentName[];
	readonly presence?: PresenceConfig;
	/** Guards for every command, component, modal and menu. */
	readonly guards?: readonly Guard[];
	/** Middleware around every handler. */
	readonly middleware?: readonly Middleware[];
	/** Every handler error, after the user has been told. Defaults to logging. */
	readonly onError?: ErrorHandler;
	/** See LifecycleOptions.autoDeferMs. */
	readonly autoDeferMs?: number | false;
	/**
	 * How `nubis start` talks to Discord: the gateway (default), or an HTTP
	 * endpoint for the Interactions Endpoint URL. HTTP bots get no events.
	 */
	readonly transport?: "gateway" | "http";
	readonly http?: {
		/** Defaults to PORT, then 3000. */
		readonly port?: number;
		/** Defaults to "/interactions". */
		readonly path?: string;
	};
	/** The test server for `nubis dev` and `nubis sync`, if not in DISCORD_DEV_GUILD_ID. */
	readonly devGuildId?: string;
}

/** Types a `nubis.config.ts`. An identity function. */
export function defineConfig(config: NubisConfig): NubisConfig {
	return config;
}

const KEYS: ReadonlySet<string> = new Set([
	"root",
	"intents",
	"presence",
	"guards",
	"middleware",
	"onError",
	"autoDeferMs",
	"transport",
	"http",
	"devGuildId",
]);

const ACTIVITY_TYPES = {
	playing: ActivityType.Playing,
	listening: ActivityType.Listening,
	watching: ActivityType.Watching,
	competing: ActivityType.Competing,
	custom: ActivityType.Custom,
} as const;

const STATUSES: Readonly<Record<string, PresenceUpdateStatus>> = {
	online: PresenceUpdateStatus.Online,
	idle: PresenceUpdateStatus.Idle,
	dnd: PresenceUpdateStatus.DoNotDisturb,
	invisible: PresenceUpdateStatus.Invisible,
};

/**
 * Checks a loaded config, so a typo fails at startup with the file and key
 * named instead of being silently ignored.
 */
export function validateConfig(config: unknown, file: string): NubisConfig {
	const where = (detail: string) => new Error(`${file}: ${detail}`);
	if (typeof config !== "object" || config === null) {
		throw where(
			"export the config as default: export default defineConfig({ ... }).",
		);
	}
	const value = config as Record<string, unknown>;
	for (const key of Object.keys(value)) {
		if (!KEYS.has(key)) {
			throw where(
				`"${key}" isn't a config setting. The settings are: ${[...KEYS].join(", ")}.`,
			);
		}
	}
	for (const name of (value.intents as unknown[] | undefined) ?? []) {
		if (
			typeof name !== "string" ||
			!(name in GatewayIntentBits) ||
			!Number.isNaN(Number(name))
		) {
			throw where(
				`"${String(name)}" isn't an intent. Use names like "MessageContent" or "GuildMembers".`,
			);
		}
	}
	const presence = value.presence as PresenceConfig | undefined;
	if (presence?.status && !(presence.status in STATUSES)) {
		throw where(
			`presence.status must be online, idle, dnd or invisible (got "${presence.status}").`,
		);
	}
	if (presence?.activity && !(presence.activity.type in ACTIVITY_TYPES)) {
		throw where(
			`presence.activity.type must be playing, listening, watching, competing or custom (got "${presence.activity.type}").`,
		);
	}
	if (
		value.transport !== undefined &&
		value.transport !== "gateway" &&
		value.transport !== "http"
	) {
		throw where(
			`transport must be "gateway" or "http" (got "${String(value.transport)}").`,
		);
	}
	return value as NubisConfig;
}

export function intentBits(names: readonly IntentName[] = []): number {
	return names.reduce((bits, name) => bits | GatewayIntentBits[name], 0);
}

/** The gateway's presence payload for a config's `presence`. */
export function presenceData(
	presence: PresenceConfig | undefined,
): GatewayPresenceUpdateData | undefined {
	if (!presence) return undefined;
	const activity = presence.activity;
	return {
		since: null,
		afk: false,
		status:
			STATUSES[presence.status ?? "online"] ?? PresenceUpdateStatus.Online,
		activities: activity
			? [
					activity.type === "custom"
						? {
								type: ActivityType.Custom,
								name: "Custom Status",
								state: activity.name,
							}
						: { type: ACTIVITY_TYPES[activity.type], name: activity.name },
				]
			: [],
	};
}
