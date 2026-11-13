import type { EventRegistry } from "@nubisjs/core";
import { GatewayIntentBits as I } from "discord-api-types/v10";

/**
 * Which gateway intents each event needs, so a bot only asks for what its
 * `events/` use. Events not listed arrive with the Guilds intent alone.
 */
const EVENT_INTENTS: Readonly<Record<string, number>> = {
	guildMemberAdd: I.GuildMembers,
	guildMemberUpdate: I.GuildMembers,
	guildMemberRemove: I.GuildMembers,
	guildBanAdd: I.GuildModeration,
	guildBanRemove: I.GuildModeration,
	guildAuditLogEntryCreate: I.GuildModeration,
	guildEmojisUpdate: I.GuildExpressions,
	guildStickersUpdate: I.GuildExpressions,
	guildSoundboardSoundCreate: I.GuildExpressions,
	guildSoundboardSoundUpdate: I.GuildExpressions,
	guildSoundboardSoundDelete: I.GuildExpressions,
	guildSoundboardSoundsUpdate: I.GuildExpressions,
	guildIntegrationsUpdate: I.GuildIntegrations,
	integrationCreate: I.GuildIntegrations,
	integrationUpdate: I.GuildIntegrations,
	integrationDelete: I.GuildIntegrations,
	webhooksUpdate: I.GuildWebhooks,
	inviteCreate: I.GuildInvites,
	inviteDelete: I.GuildInvites,
	voiceStateUpdate: I.GuildVoiceStates,
	voiceChannelEffectSend: I.GuildVoiceStates,
	presenceUpdate: I.GuildPresences,
	messageCreate: I.GuildMessages | I.DirectMessages,
	messageUpdate: I.GuildMessages | I.DirectMessages,
	messageDelete: I.GuildMessages | I.DirectMessages,
	messageDeleteBulk: I.GuildMessages,
	messageReactionAdd: I.GuildMessageReactions | I.DirectMessageReactions,
	messageReactionRemove: I.GuildMessageReactions | I.DirectMessageReactions,
	messageReactionRemoveAll: I.GuildMessageReactions | I.DirectMessageReactions,
	messageReactionRemoveEmoji:
		I.GuildMessageReactions | I.DirectMessageReactions,
	typingStart: I.GuildMessageTyping | I.DirectMessageTyping,
	guildScheduledEventCreate: I.GuildScheduledEvents,
	guildScheduledEventUpdate: I.GuildScheduledEvents,
	guildScheduledEventDelete: I.GuildScheduledEvents,
	guildScheduledEventUserAdd: I.GuildScheduledEvents,
	guildScheduledEventUserRemove: I.GuildScheduledEvents,
	autoModerationRuleCreate: I.AutoModerationConfiguration,
	autoModerationRuleUpdate: I.AutoModerationConfiguration,
	autoModerationRuleDelete: I.AutoModerationConfiguration,
	autoModerationActionExecution: I.AutoModerationExecution,
	messagePollVoteAdd: I.GuildMessagePolls | I.DirectMessagePolls,
	messagePollVoteRemove: I.GuildMessagePolls | I.DirectMessagePolls,
};

/** Intents Discord makes you switch on in the Developer Portal first. */
export const PRIVILEGED_INTENTS =
	I.GuildMembers | I.GuildPresences | I.MessageContent;

/**
 * The intents a bot needs for the events it listens to, plus any extra it
 * asks for (MessageContent, for instance, is never added automatically).
 * Interactions need no intent at all.
 */
export function intentsFor(events: EventRegistry, extra = 0): number {
	let intents = I.Guilds | extra;
	for (const name of events.keys()) intents |= EVENT_INTENTS[name] ?? 0;
	return intents;
}

/** Readable names for a bit field, for logs and errors. */
export function intentNames(intents: number): string[] {
	return Object.entries(I)
		.filter(
			([name, bit]) =>
				typeof bit === "number" &&
				(intents & bit) === bit &&
				// Skip the old aliases that share a bit with the current names.
				name !== "GuildBans" &&
				name !== "GuildEmojisAndStickers",
		)
		.map(([name]) => name);
}
