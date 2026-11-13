import { describe, expect, test } from "bun:test";
import { ComponentType, TextInputStyle } from "discord-api-types/v10";
import { z } from "zod";
import {
	chatInput,
	componentInteraction,
	modalSubmit,
	recorder,
} from "./__fixtures__/interactions";
import {
	buildCommandTree,
	button,
	command,
	createComponentRegistry,
	dispatch,
	dispatchComponent,
	dispatchModal,
	modal,
	textInput,
} from "./index";

type Equal<A, B> =
	(<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
		? true
		: false;
const assertType = <_T extends true>() => {};

const submitted: unknown[] = [];
const report = modal({
	id: "report",
	title: "Report a player",
	fields: {
		player: textInput({ label: "Player", required: true, maxLength: 32 }),
		details: textInput({
			label: "What happened?",
			style: "paragraph",
			placeholder: "Be specific",
		}),
	},
	state: z.object({ serverId: z.string() }),
	onSubmit: async ({ values, state, reply }) => {
		assertType<
			Equal<typeof values, { player: string; details: string | undefined }>
		>();
		submitted.push({ values, state });
		await reply({ content: `Reported ${values.player}`, ephemeral: true });
	},
});

describe("modal", () => {
	test("renders labelled text inputs with its state in the custom_id", () => {
		expect(report({ serverId: "s1" })).toEqual({
			custom_id: 'report~{"serverId":"s1"}',
			title: "Report a player",
			components: [
				{
					type: ComponentType.Label,
					label: "Player",
					component: {
						type: ComponentType.TextInput,
						custom_id: "player",
						style: TextInputStyle.Short,
						required: true,
						max_length: 32,
					},
				},
				{
					type: ComponentType.Label,
					label: "What happened?",
					component: {
						type: ComponentType.TextInput,
						custom_id: "details",
						style: TextInputStyle.Paragraph,
						required: false,
						placeholder: "Be specific",
					},
				},
			],
		});
	});

	test("can prefill fields and change the title per render", () => {
		const data = report(
			{ serverId: "s1" },
			{ title: "Edit report", values: { player: "Steve" } },
		);
		expect(data.title).toBe("Edit report");
		expect(data.components[0]).toMatchObject({ component: { value: "Steve" } });
	});

	test("hands typed values to onSubmit; empty optional fields are undefined", async () => {
		submitted.length = 0;
		const { replies, responder } = recorder();
		const result = await dispatchModal(
			createComponentRegistry([report]),
			modalSubmit('report~{"serverId":"s1"}', { player: "Steve", details: "" }),
			responder,
		);

		expect(result).toEqual({ status: "handled", id: "report" });
		expect(submitted).toEqual([
			{
				values: { player: "Steve", details: undefined },
				state: { serverId: "s1" },
			},
		]);
		expect(replies).toEqual(["Reported Steve"]);
	});

	test("missing required fields or tampered state are stale", async () => {
		const registry = createComponentRegistry([report]);
		for (const interaction of [
			modalSubmit('report~{"serverId":"s1"}', { details: "no player" }),
			modalSubmit('report~{"serverId":1}', { player: "Steve" }),
		]) {
			const { responder } = recorder();
			expect(
				(await dispatchModal(registry, interaction, responder)).status,
			).toBe("stale");
		}
	});

	test("modals and components can't trigger each other", async () => {
		const ok = button({ id: "ok", label: "OK", onClick: () => {} });
		const registry = createComponentRegistry([report, ok]);
		const { responder } = recorder();

		const asClick = await dispatchComponent(
			registry,
			componentInteraction('report~{"serverId":"s1"}', {
				type: ComponentType.Button,
			}),
			responder,
		);
		const asSubmit = await dispatchModal(
			registry,
			modalSubmit("ok", {}),
			responder,
		);

		expect(asClick.status).toBe("stale");
		expect(asSubmit.status).toBe("stale");
	});

	test("checks Discord's modal limits up front", () => {
		const field = textInput({ label: "Field" });
		const make = (overrides: Partial<Parameters<typeof modal>[0]>) => () =>
			modal({
				id: "m",
				title: "Title",
				fields: { a: field },
				onSubmit: () => {},
				...overrides,
			});

		expect(make({ title: "x".repeat(46) })).toThrow(
			/title must be 1-45 characters/,
		);
		expect(
			make({
				fields: { a: field, b: field, c: field, d: field, e: field, f: field },
			}),
		).toThrow(/needs 1-5 fields/);
		expect(make({ fields: { "has space": field } })).toThrow(
			/field names must be/,
		);
		expect(
			make({
				fields: { a: textInput({ label: "A", minLength: 10, maxLength: 5 }) },
			}),
		).toThrow(/minLength is larger than maxLength/);
		expect(
			make({ fields: { a: textInput({ label: "x".repeat(46) }) } }),
		).toThrow(/label must be 1-45/);
	});
});

describe("showModal", () => {
	test("a command can open a modal", async () => {
		const tree = buildCommandTree([
			{
				path: ["report"],
				definition: command({
					description: "Report a player",
					run: ({ showModal }) => showModal(report({ serverId: "s1" })),
				}),
			},
		]);
		const { modals, responder } = recorder();
		await dispatch(tree, chatInput("report"), responder);
		expect(modals.map((m) => m.custom_id)).toEqual([
			'report~{"serverId":"s1"}',
		]);
	});

	test("a button can open a modal", async () => {
		const open = button({
			id: "open-report",
			label: "Report",
			state: z.object({ serverId: z.string() }),
			onClick: ({ state, showModal }) =>
				showModal(report({ serverId: state.serverId })),
		});
		const { modals, responder } = recorder();
		await dispatchComponent(
			createComponentRegistry([open]),
			componentInteraction(open({ serverId: "s2" }).custom_id, {
				type: ComponentType.Button,
			}),
			responder,
		);
		expect(modals[0]?.title).toBe("Report a player");
		expect(modals[0]?.custom_id).toBe('report~{"serverId":"s2"}');
	});
});
