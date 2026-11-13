import {
	type APIInteractionDataResolvedChannel,
	type APIMessage,
	type APIRole,
	type APIUser,
	ChannelType,
} from "discord-api-types/v10";

let next = 100_000_000_000_000_000n;
/** Snowflake-shaped ids, unique within a test run. */
export const fakeId = (): string => String(next++);

/**
 * Fake Discord objects for tests. Only the fields bots commonly read are
 * filled in; pass `overrides` for anything else.
 */
export const fake = {
	user(name = "tester", overrides: Partial<APIUser> = {}): APIUser {
		return {
			id: fakeId(),
			username: name,
			global_name: name,
			discriminator: "0",
			avatar: null,
			...overrides,
		};
	},

	role(name = "role", overrides: Partial<APIRole> = {}): APIRole {
		return {
			id: fakeId(),
			name,
			color: 0,
			colors: { primary_color: 0, secondary_color: null, tertiary_color: null },
			hoist: false,
			position: 1,
			permissions: "0",
			managed: false,
			mentionable: false,
			flags: 0,
			...overrides,
		} as APIRole;
	},

	channel(
		name = "general",
		overrides: Partial<APIInteractionDataResolvedChannel> = {},
	): APIInteractionDataResolvedChannel {
		return {
			id: fakeId(),
			name,
			type: ChannelType.GuildText,
			permissions: "0",
			...overrides,
		} as APIInteractionDataResolvedChannel;
	},

	message(content = "", overrides: Partial<APIMessage> = {}): APIMessage {
		return {
			id: fakeId(),
			channel_id: fakeId(),
			author: fake.user("author"),
			content,
			timestamp: new Date(0).toISOString(),
			edited_timestamp: null,
			tts: false,
			mention_everyone: false,
			mentions: [],
			mention_roles: [],
			attachments: [],
			embeds: [],
			pinned: false,
			type: 0,
			...overrides,
		} as APIMessage;
	},
};
