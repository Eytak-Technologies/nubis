import { describe, expect, test } from "bun:test";
import {
	type APIMessageComponentInteraction,
	ButtonStyle,
	ChannelType,
	ComponentType,
	SelectMenuDefaultValueType,
} from "discord-api-types/v10";
import { z } from "zod";
import {
	actorFields,
	chatInput,
	componentInteraction,
	recorder,
} from "./__fixtures__/interactions";
import {
	buildCommandTree,
	button,
	channelSelect,
	command,
	createComponentRegistry,
	dispatch,
	dispatchComponent,
	ERROR_MESSAGE,
	linkButton,
	memoryStore,
	mentionableSelect,
	roleSelect,
	type StateStore,
	stateOf,
	stringSelect,
	toEmoji,
	userSelect,
} from "./index";

const quiet = { autoDeferMs: false } as const;

const selectInteraction = (
	customId: string,
	componentType: ComponentType,
	values: string[],
	resolved: object,
): APIMessageComponentInteraction =>
	({
		...actorFields({ guildId: "g1" }),
		id: "1",
		application_id: "2",
		type: 3,
		token: "t",
		version: 1,
		data: {
			custom_id: customId,
			component_type: componentType,
			values,
			resolved,
		},
	}) as unknown as APIMessageComponentInteraction;

const alice = { id: "1", username: "alice", discriminator: "0" };
const mods = { id: "r1", name: "Mods" };

describe("user, role, channel and mentionable selects", () => {
	test("render with defaults, limits and placeholder", () => {
		const pick = userSelect({
			id: "pick-user",
			placeholder: "Who?",
			maxValues: 3,
			onSelect: () => {},
		});
		expect(pick({ defaultUsers: ["1"] })).toEqual({
			type: ComponentType.UserSelect,
			custom_id: "pick-user",
			placeholder: "Who?",
			max_values: 3,
			default_values: [{ id: "1", type: SelectMenuDefaultValueType.User }],
		});

		const where = channelSelect({
			id: "where",
			channelTypes: [ChannelType.GuildText],
			onSelect: () => {},
		});
		expect(where()).toMatchObject({
			type: ComponentType.ChannelSelect,
			channel_types: [ChannelType.GuildText],
		});
	});

	test("hand handlers resolved objects, not ids", async () => {
		const seen: unknown[] = [];
		const pickUser = userSelect({
			id: "pick-user",
			state: stateOf<{ reason: string }>(),
			onSelect: ({ users, members, state }) => {
				seen.push([users[0]?.username, members["1"]?.nick, state.reason]);
			},
		});
		const pickRole = roleSelect({
			id: "pick-role",
			onSelect: ({ roles }) => {
				seen.push(roles.map((role) => role.name));
			},
		});
		const pickAny = mentionableSelect({
			id: "pick-any",
			onSelect: ({ users, roles }) => {
				seen.push([users.length, roles.length]);
			},
		});
		const registry = createComponentRegistry([pickUser, pickRole, pickAny]);
		const { transport } = recorder();

		await dispatchComponent(
			registry,
			selectInteraction(
				pickUser({ reason: "spam" }).custom_id,
				ComponentType.UserSelect,
				["1"],
				{ users: { "1": alice }, members: { "1": { nick: "Al", roles: [] } } },
			),
			transport,
			quiet,
		);
		await dispatchComponent(
			registry,
			selectInteraction("pick-role", ComponentType.RoleSelect, ["r1"], {
				roles: { r1: mods },
			}),
			transport,
			quiet,
		);
		await dispatchComponent(
			registry,
			selectInteraction(
				"pick-any",
				ComponentType.MentionableSelect,
				["1", "r1"],
				{
					users: { "1": alice },
					roles: { r1: mods },
				},
			),
			transport,
			quiet,
		);

		expect(seen).toEqual([["alice", "Al", "spam"], ["Mods"], [1, 1]]);
	});

	test("missing resolved data or the wrong menu type is stale", async () => {
		const pickRole = roleSelect({ id: "pick-role", onSelect: () => {} });
		const registry = createComponentRegistry([pickRole]);
		const { transport } = recorder();

		const missing = await dispatchComponent(
			registry,
			selectInteraction("pick-role", ComponentType.RoleSelect, ["r9"], {
				roles: {},
			}),
			transport,
			quiet,
		);
		const wrongType = await dispatchComponent(
			registry,
			selectInteraction("pick-role", ComponentType.UserSelect, ["1"], {
				users: { "1": alice },
			}),
			transport,
			quiet,
		);
		expect([missing.status, wrongType.status]).toEqual(["stale", "stale"]);
	});

	test("check value counts and channel types", () => {
		expect(() =>
			userSelect({ id: "u", minValues: 3, maxValues: 2, onSelect: () => {} }),
		).toThrow(/0 <= min <= max <= 25/);
		expect(() =>
			stringSelect({
				id: "s",
				maxValues: 3,
				options: [{ label: "A", value: "a" }],
				onSelect: () => {},
			}),
		).toThrow(/<= 1/);
		expect(() =>
			channelSelect({ id: "c", channelTypes: [], onSelect: () => {} }),
		).toThrow(/at least one type/);
	});
});

describe("link buttons and emoji", () => {
	test("link buttons open a URL and need no handler", () => {
		expect(
			linkButton({ label: "Docs", url: "https://nubis.dev", emoji: "📖" }),
		).toEqual({
			type: ComponentType.Button,
			style: ButtonStyle.Link,
			url: "https://nubis.dev",
			label: "Docs",
			emoji: { name: "📖" },
		});
		expect(() =>
			linkButton({ label: "Bad", url: "javascript:alert(1)" }),
		).toThrow(/must start with https:\/\//);
		expect(() => linkButton({ url: "https://x.dev" })).toThrow(
			/label, an emoji/,
		);
	});

	test("emoji take unicode, custom and animated forms", () => {
		expect(toEmoji("🔥")).toEqual({ name: "🔥" });
		expect(toEmoji("<:party:123456789012345678>")).toEqual({
			id: "123456789012345678",
			name: "party",
		});
		expect(toEmoji("<a:dance:123456789012345678>")).toEqual({
			id: "123456789012345678",
			name: "dance",
			animated: true,
		});
	});

	test("buttons and select options carry emoji", () => {
		const fire = button({
			id: "fire",
			label: "Fire",
			emoji: "🔥",
			onClick: () => {},
		});
		expect(fire().emoji).toEqual({ name: "🔥" });
		expect(fire({ emoji: "💧" }).emoji).toEqual({ name: "💧" });

		const pick = stringSelect({
			id: "pick",
			options: [{ label: "Fire", value: "fire", emoji: "🔥" }],
			onSelect: () => {},
		});
		expect(pick().options[0]).toEqual({
			label: "Fire",
			value: "fire",
			emoji: { name: "🔥" },
		});
	});

	test("button labels follow Discord's 80-character limit", () => {
		expect(() =>
			button({ id: "long", label: "x".repeat(81), onClick: () => {} }),
		).toThrow(/at most 80 characters/);
	});
});

describe("state stores", () => {
	test("keep large state out of the custom_id and bring it back validated", async () => {
		const store = memoryStore();
		const notes: string[] = [];
		const save = button({
			id: "save-note",
			label: "Save",
			state: z.object({ text: z.string() }),
			store,
			onClick: ({ state }) => {
				notes.push(state.text);
			},
		});
		const text = "a long note ".repeat(20);
		const rendered = save({ text });

		expect(rendered.custom_id).toMatch(/^save-note~\$[\w-]{16}$/);
		expect(store.size).toBe(1);

		const { transport } = recorder();
		const result = await dispatchComponent(
			createComponentRegistry([save]),
			componentInteraction(rendered.custom_id, { type: ComponentType.Button }),
			transport,
			quiet,
		);
		expect(result.status).toBe("handled");
		expect(notes).toEqual([text]);
	});

	test("expired or unknown keys are stale", async () => {
		let now = 0;
		const store = memoryStore({ ttlMs: 1000, now: () => now });
		const save = button({
			id: "save",
			label: "Save",
			state: stateOf<{ n: number }>(),
			store,
			onClick: () => {},
		});
		const rendered = save({ n: 1 });
		now = 1000;

		const { transport } = recorder();
		const result = await dispatchComponent(
			createComponentRegistry([save]),
			componentInteraction(rendered.custom_id, { type: ComponentType.Button }),
			transport,
			quiet,
		);
		expect(result).toMatchObject({
			status: "stale",
			reason: "stored state expired or missing",
		});
	});

	test("the memory store drops its oldest entries past its limit", () => {
		const store = memoryStore({ maxEntries: 2 });
		store.set("a", 1);
		store.set("b", 2);
		store.set("c", 3);
		expect([store.get("a"), store.get("b"), store.get("c")]).toEqual([
			undefined,
			2,
			3,
		]);
	});

	test("a message isn't sent before its components' state is saved", async () => {
		const order: string[] = [];
		let finishWrite = () => {};
		const slowStore: StateStore = {
			set: () =>
				new Promise<void>((resolve) => {
					finishWrite = () => {
						order.push("state saved");
						resolve();
					};
				}),
			get: () => undefined,
		};
		const confirm = button({
			id: "confirm",
			label: "Confirm",
			state: stateOf<{ id: string }>(),
			store: slowStore,
			onClick: () => {},
		});
		const ask = command({
			description: "Ask",
			run: ({ reply }) =>
				reply({ content: "Sure?", components: [confirm({ id: "1" })] }),
		});
		const rec = recorder();
		const transport = {
			...rec.transport,
			respond: async (
				response: Parameters<typeof rec.transport.respond>[0],
			) => {
				order.push("message sent");
				await rec.transport.respond(response);
			},
		};

		const running = dispatch(
			buildCommandTree([{ path: ["ask"], definition: ask }]),
			chatInput("ask"),
			transport,
			quiet,
		);
		await new Promise((resolve) => setTimeout(resolve, 5));
		expect(order).toEqual([]); // still waiting on the store
		finishWrite();
		await running;

		expect(order).toEqual(["state saved", "message sent"]);
	});

	test("a failed state write fails the reply instead of sending a dead button", async () => {
		const brokenStore: StateStore = {
			set: async () => {
				throw new Error("redis down");
			},
			get: () => undefined,
		};
		const confirm = button({
			id: "confirm",
			label: "Confirm",
			state: stateOf<{ id: string }>(),
			store: brokenStore,
			onClick: () => {},
		});
		const ask = command({
			description: "Ask",
			run: ({ reply }) =>
				reply({ content: "Sure?", components: [confirm({ id: "1" })] }),
		});
		const { replies, transport } = recorder();
		const result = await dispatch(
			buildCommandTree([{ path: ["ask"], definition: ask }]),
			chatInput("ask"),
			transport,
			quiet,
		);

		expect(result.status).toBe("error");
		expect(String((result as { error: unknown }).error)).toMatch(/redis down/);
		expect(replies).toEqual([ERROR_MESSAGE]);
	});
});
