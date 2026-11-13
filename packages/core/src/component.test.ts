import { describe, expect, test } from "bun:test";
import { ButtonStyle, ComponentType } from "discord-api-types/v10";
import { z } from "zod";
import { componentInteraction, recorder } from "./__fixtures__/interactions";
import {
	button,
	createComponentRegistry,
	dispatchComponent,
	NubisError,
	STALE_MESSAGE,
	stateOf,
	stringSelect,
	toActionRows,
} from "./index";

type Equal<A, B> =
	(<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
		? true
		: false;
const assertType = <_T extends true>() => {};

const click = (customId: string) =>
	componentInteraction(customId, { type: ComponentType.Button });

describe("button", () => {
	test("renders without state, with overrides", () => {
		const refresh = button({
			id: "refresh",
			label: "Refresh",
			onClick: () => {},
		});

		expect(refresh()).toEqual({
			type: ComponentType.Button,
			custom_id: "refresh",
			label: "Refresh",
			style: ButtonStyle.Secondary,
		});
		expect(
			refresh({ label: "Again", style: "primary", disabled: true }),
		).toMatchObject({
			label: "Again",
			style: ButtonStyle.Primary,
			disabled: true,
		});
	});

	test("puts typed state in the custom_id and gets it back validated", async () => {
		const confirmBan = button({
			id: "confirm-ban",
			label: "Confirm",
			style: "danger",
			state: z.object({ userId: z.string(), days: z.number().int() }),
			onClick: async ({ state, update }) => {
				assertType<Equal<typeof state, { userId: string; days: number }>>();
				await update(`Banned ${state.userId} for ${state.days} days`);
			},
		});

		const rendered = confirmBan({ userId: "42", days: 7 });
		expect(rendered.custom_id).toBe('confirm-ban~{"userId":"42","days":7}');
		// @ts-expect-error: a button with state can't be rendered without it
		expect(() => confirmBan()).not.toThrow();

		const { messages, responder } = recorder();
		const result = await dispatchComponent(
			createComponentRegistry([confirmBan]),
			click(rendered.custom_id),
			responder,
		);

		expect(result).toEqual({ status: "handled", id: "confirm-ban" });
		expect(messages).toEqual([
			{
				kind: "update",
				message: {
					content: "Banned 42 for 7 days",
					components: undefined,
					ephemeral: false,
				},
			},
		]);
	});

	test("treats tampered or broken state as stale, not as input", async () => {
		let clicks = 0;
		const confirmBan = button({
			id: "confirm-ban",
			label: "Confirm",
			state: z.object({ userId: z.string().regex(/^\d+$/) }),
			onClick: () => {
				clicks++;
			},
		});
		const registry = createComponentRegistry([confirmBan]);

		for (const customId of [
			'confirm-ban~{"userId":"everyone"}',
			"confirm-ban~{not json",
		]) {
			const { messages, responder } = recorder();
			const result = await dispatchComponent(
				registry,
				click(customId),
				responder,
			);
			expect(result.status).toBe("stale");
			expect(messages[0]?.message).toEqual({
				content: STALE_MESSAGE,
				components: undefined,
				ephemeral: true,
			});
		}
		expect(clicks).toBe(0);
	});

	test("refuses state that won't fit in Discord's 100 characters", () => {
		const note = button({
			id: "note",
			label: "Note",
			state: stateOf<{ text: string }>(),
			onClick: () => {},
		});
		expect(() => note({ text: "x".repeat(100) })).toThrow(
			/would be 1\d\d characters, and Discord allows 100/,
		);
	});

	test("rejects invalid ids", () => {
		expect(() =>
			button({ id: "Has Space", label: "x", onClick: () => {} }),
		).toThrow(NubisError);
		expect(() => button({ id: "a~b", label: "x", onClick: () => {} })).toThrow(
			NubisError,
		);
	});
});

describe("stringSelect", () => {
	const role = stringSelect({
		id: "pick-role",
		placeholder: "Pick a role",
		maxValues: 2,
		options: [
			{ label: "Builder", value: "builder" },
			{ label: "Redstoner", value: "redstoner" },
		],
		state: stateOf<{ guild: string }>(),
		onSelect: async ({ values, state, reply }) => {
			assertType<Equal<typeof values, ("builder" | "redstoner")[]>>();
			await reply({
				content: `${state.guild}: ${values.join(",")}`,
				ephemeral: true,
			});
		},
	});

	test("renders its options", () => {
		expect(role({ guild: "g1" })).toEqual({
			type: ComponentType.StringSelect,
			custom_id: 'pick-role~{"guild":"g1"}',
			placeholder: "Pick a role",
			max_values: 2,
			options: [
				{ label: "Builder", value: "builder" },
				{ label: "Redstoner", value: "redstoner" },
			],
		});
	});

	test("hands typed values to the handler", async () => {
		const { replies, responder } = recorder();
		const result = await dispatchComponent(
			createComponentRegistry([role]),
			componentInteraction('pick-role~{"guild":"g1"}', {
				type: ComponentType.StringSelect,
				values: ["redstoner", "builder"],
			}),
			responder,
		);
		expect(result.status).toBe("handled");
		expect(replies).toEqual(["g1: redstoner,builder"]);
	});

	test("values that aren't options anymore are stale", async () => {
		const { responder } = recorder();
		const result = await dispatchComponent(
			createComponentRegistry([role]),
			componentInteraction('pick-role~{"guild":"g1"}', {
				type: ComponentType.StringSelect,
				values: ["admin"],
			}),
			responder,
		);
		expect(result.status).toBe("stale");
	});

	test("checks Discord's option rules up front", () => {
		expect(() =>
			stringSelect({ id: "empty", options: [], onSelect: () => {} }),
		).toThrow(/needs 1-25 options/);
		expect(() =>
			stringSelect({
				id: "dupes",
				options: [
					{ label: "A", value: "a" },
					{ label: "B", value: "a" },
				],
				onSelect: () => {},
			}),
		).toThrow(/unique/);
	});
});

describe("dispatchComponent", () => {
	test("unknown ids are reported, not answered", async () => {
		const { messages, responder } = recorder();
		const result = await dispatchComponent(
			createComponentRegistry([]),
			click("from-another-bot"),
			responder,
		);
		expect(result).toEqual({ status: "unknown", customId: "from-another-bot" });
		expect(messages).toEqual([]);
	});

	test("a select interaction can't trigger a button handler", async () => {
		const refresh = button({
			id: "refresh",
			label: "Refresh",
			onClick: () => {},
		});
		const { responder } = recorder();
		const result = await dispatchComponent(
			createComponentRegistry([refresh]),
			componentInteraction("refresh", {
				type: ComponentType.StringSelect,
				values: [],
			}),
			responder,
		);
		expect(result.status).toBe("stale");
	});

	test("duplicate ids are a definition error", () => {
		const a = button({ id: "same", label: "A", onClick: () => {} });
		const b = button({ id: "same", label: "B", onClick: () => {} });
		expect(() => createComponentRegistry([a, b])).toThrow(
			/Two components use the id "same"/,
		);
	});
});

describe("toActionRows", () => {
	const b = (n: number) =>
		button({ id: `b${n}`, label: `${n}`, onClick: () => {} })();

	test("packs buttons five to a row and gives selects their own row", () => {
		const select = stringSelect({
			id: "s",
			options: [{ label: "A", value: "a" }],
			onSelect: () => {},
		})();
		const rows = toActionRows([
			b(1),
			b(2),
			b(3),
			b(4),
			b(5),
			b(6),
			b(7),
			select,
			b(8),
		]);
		expect(rows.map((row) => row.components.length)).toEqual([5, 2, 1, 1]);
		expect(rows[2]?.components[0]?.type).toBe(ComponentType.StringSelect);
	});

	test("refuses more than five rows", () => {
		const many = Array.from({ length: 26 }, (_, i) => b(i));
		expect(() => toActionRows(many)).toThrow(/at most 5 rows/);
	});
});
