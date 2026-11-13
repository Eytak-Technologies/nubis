import { describe, expect, test } from "bun:test";
import { ComponentType } from "discord-api-types/v10";
import {
	autocomplete,
	chatInput,
	componentInteraction,
	recorder,
} from "./__fixtures__/interactions";
import {
	buildCommandTree,
	button,
	command,
	createComponentRegistry,
	createEventRegistry,
	dispatch,
	dispatchAutocomplete,
	dispatchComponent,
	dispatchEvent,
	type ErrorInfo,
	event,
	option,
} from "./index";

const quiet = { autoDeferMs: false } as const;
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

describe("files", () => {
	test("go with the reply, listed as attachments by index", async () => {
		const chart = command({
			description: "Chart",
			run: ({ reply }) =>
				reply({
					embeds: [{ image: { url: "attachment://chart.png" } }],
					files: [
						{ name: "chart.png", data: png, description: "Weekly players" },
						{ name: "data.csv", data: "day,players\nmon,12" },
					],
				}),
		});
		const { calls, uploads, transport } = recorder();
		await dispatch(
			buildCommandTree([{ path: ["chart"], definition: chart }]),
			chatInput("chart"),
			transport,
			quiet,
		);

		expect(uploads).toEqual([
			{ call: "respond:4", files: ["chart.png", "data.csv"] },
		]);
		expect(calls[0]).toMatchObject({
			response: {
				data: {
					attachments: [
						{ id: 0, filename: "chart.png", description: "Weekly players" },
						{ id: 1, filename: "data.csv" },
					],
				},
			},
		});
	});

	test("ride along on follow-ups, edits and updates", async () => {
		const shot = button({
			id: "shot",
			label: "Shot",
			onClick: async ({ update, reply }) => {
				await update({
					content: "updated",
					files: [{ name: "a.txt", data: "a" }],
				});
				await reply({ content: "also", files: [{ name: "b.txt", data: "b" }] });
			},
		});
		const { uploads, transport } = recorder();
		await dispatchComponent(
			createComponentRegistry([shot]),
			componentInteraction("shot", { type: ComponentType.Button }),
			transport,
			quiet,
		);
		expect(uploads).toEqual([
			{ call: "respond:7", files: ["a.txt"] },
			{ call: "followUp", files: ["b.txt"] },
		]);
	});

	test("Discord's limit of ten per message is checked", async () => {
		const many = command({
			description: "Many",
			run: ({ reply }) =>
				reply({
					files: Array.from({ length: 11 }, (_, i) => ({
						name: `${i}.txt`,
						data: "x",
					})),
				}),
		});
		const { transport } = recorder();
		const result = await dispatch(
			buildCommandTree([{ path: ["many"], definition: many }]),
			chatInput("many"),
			transport,
			quiet,
		);
		expect(result.status).toBe("error");
		expect(String((result as { error: unknown }).error)).toMatch(
			/at most 10 files/,
		);
	});
});

describe("onError", () => {
	const boom = () => {
		throw new Error("boom");
	};

	test("hears about every kind of handler error, with where it happened", async () => {
		const seen: ErrorInfo[] = [];
		const onError = (_error: unknown, info: ErrorInfo) => {
			seen.push(info);
		};
		const tree = buildCommandTree([
			{
				path: ["fail"],
				definition: command({ description: "Fail", run: boom }),
			},
			{
				path: ["search"],
				definition: command({
					description: "Search",
					options: { q: option.string({ autocomplete: boom }) },
					run: () => {},
				}),
			},
		]);
		const { transport } = recorder();

		await dispatch(tree, chatInput("fail"), transport, { ...quiet, onError });
		await dispatchComponent(
			createComponentRegistry([button({ id: "b", label: "B", onClick: boom })]),
			componentInteraction("b", { type: ComponentType.Button }),
			transport,
			{ ...quiet, onError },
		);
		await dispatchAutocomplete(
			tree,
			autocomplete("search", [
				{ type: 3, name: "q", value: "x", focused: true },
			]),
			transport,
			{ onError },
		);
		await dispatchEvent(
			createEventRegistry([event("ready", boom)]),
			"READY",
			{},
			{ onError },
		);

		expect(seen.map(({ kind, name }) => `${kind} ${name}`)).toEqual([
			"command /fail",
			"component b",
			"autocomplete /search",
			"event ready",
		]);
		expect(seen[0]?.interaction).toBeDefined();
	});

	test("an error handler that throws doesn't break the answer", async () => {
		const { replies, transport } = recorder();
		const result = await dispatch(
			buildCommandTree([
				{
					path: ["fail"],
					definition: command({ description: "Fail", run: boom }),
				},
			]),
			chatInput("fail"),
			transport,
			{
				...quiet,
				onError: () => {
					throw new Error("logger down");
				},
			},
		);
		expect(result.status).toBe("error");
		expect(replies).toHaveLength(1);
	});
});
