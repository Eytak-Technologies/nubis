import { describe, expect, test } from "bun:test";
import type { APIApplicationCommand } from "discord-api-types/v10";
import { command } from "./command";
import { messageCommand, toMenuPayloads } from "./menu";
import { option } from "./option";
import { toCommandPayloads } from "./serialize";
import { planSync } from "./sync";
import { buildCommandTree } from "./tree";

const run = () => undefined;

const roll = command({
	description: "Roll a die",
	nameLocalizations: { tr: "zar" },
	descriptionLocalizations: { tr: "Bir zar at", de: "Würfle" },
	options: {
		sides: option.integer({
			required: true,
			description: "How many sides",
			descriptionLocalizations: { tr: "Kaç yüzlü" },
			choices: [
				{ name: "Six", value: 6, nameLocalizations: { tr: "Altı" } },
				{ name: "Twenty", value: 20 },
			],
		}),
	},
	run: ({ options }) => {
		// Localizing a choice doesn't widen the inferred type.
		const sides: 6 | 20 = options.sides;
		return sides;
	},
});

describe("localizations", () => {
	test("commands, options and choices carry them to Discord", () => {
		const [payload] = toCommandPayloads(
			buildCommandTree([{ path: ["roll"], definition: roll }]),
		);
		expect(payload).toMatchObject({
			name: "roll",
			name_localizations: { tr: "zar" },
			description_localizations: { tr: "Bir zar at", de: "Würfle" },
			options: [
				{
					name: "sides",
					description_localizations: { tr: "Kaç yüzlü" },
					choices: [
						{ name: "Six", value: 6, name_localizations: { tr: "Altı" } },
						{ name: "Twenty", value: 20 },
					],
				},
			],
		});
		// Nothing is sent for what wasn't localized.
		expect(payload?.options?.[0]).not.toHaveProperty("name_localizations");
	});

	test("folders and subcommands, at both levels", () => {
		const [payload] = toCommandPayloads(
			buildCommandTree(
				[
					{
						path: ["config", "roles", "add"],
						definition: command({
							description: "Add a role",
							descriptionLocalizations: { tr: "Rol ekle" },
							run,
						}),
					},
				],
				[
					{
						path: ["config"],
						description: "Settings",
						descriptionLocalizations: { tr: "Ayarlar" },
						nameLocalizations: { tr: "ayarlar" },
					},
					{
						path: ["config", "roles"],
						descriptionLocalizations: { tr: "Roller" },
					},
				],
			),
		);
		expect(payload).toMatchObject({
			name_localizations: { tr: "ayarlar" },
			description_localizations: { tr: "Ayarlar" },
			options: [
				{
					name: "roles",
					description_localizations: { tr: "Roller" },
					options: [
						{ name: "add", description_localizations: { tr: "Rol ekle" } },
					],
				},
			],
		});
	});

	test("context menus", () => {
		const [payload] = toMenuPayloads([
			messageCommand({
				name: "Report message",
				nameLocalizations: { tr: "Mesajı bildir" },
				run,
			}),
		]);
		expect(payload).toMatchObject({
			name: "Report message",
			name_localizations: { tr: "Mesajı bildir" },
		});
	});

	test("Discord's rules apply to every language, and the error says which", () => {
		const payloadsOf = (definition: ReturnType<typeof command>) => () =>
			toCommandPayloads(buildCommandTree([{ path: ["roll"], definition }]));

		expect(
			payloadsOf(
				command({ description: "x", nameLocalizations: { tr: "Zar" }, run }),
			),
		).toThrow(/\/roll \(tr\): "Zar" is not a valid Discord command/);
		expect(
			payloadsOf(
				command({
					description: "x",
					descriptionLocalizations: { de: "x".repeat(101) },
					run,
				}),
			),
		).toThrow(/\/roll \(de\): descriptions must be 1-100 characters/);
		expect(
			payloadsOf(
				command({
					description: "x",
					// @ts-expect-error: not a Discord locale
					descriptionLocalizations: { turkish: "Zar" },
					run,
				}),
			),
		).toThrow(/"turkish" isn't a Discord locale/);
		expect(
			payloadsOf(
				command({
					description: "x",
					options: {
						size: option.string({
							choices: [
								{ name: "S", value: "s", nameLocalizations: { tr: " " } },
							],
						}),
					},
					run,
				}),
			),
		).toThrow(/choice "S" \(tr\): must be 1-100 characters and not blank/);
	});
});

describe("planSync with localizations", () => {
	const remoteOf = (payload: object) =>
		({
			id: "1",
			application_id: "a",
			version: "1",
			...payload,
		}) as never as APIApplicationCommand;
	const [local] = toCommandPayloads(
		buildCommandTree([{ path: ["roll"], definition: roll }]),
	);
	if (!local) throw new Error("no payload");

	test("the same translations are unchanged, whatever order Discord returns them in", () => {
		const remote = remoteOf({
			...local,
			description_localizations: { de: "Würfle", tr: "Bir zar at" },
		});
		expect(planSync([local], [remote]).unchanged).toEqual(["roll"]);
	});

	test("a changed translation is an update", () => {
		const remote = remoteOf({
			...local,
			description_localizations: { tr: "Zar at", de: "Würfle" },
		});
		expect(planSync([local], [remote]).update).toHaveLength(1);
	});

	test("Discord's null is the same as none", () => {
		const [plain] = toCommandPayloads(
			buildCommandTree([
				{ path: ["ping"], definition: command({ description: "Ping", run }) },
			]),
		);
		if (!plain) throw new Error("no payload");
		const remote = remoteOf({
			...plain,
			name_localizations: null,
			description_localizations: null,
		});
		expect(planSync([plain], [remote]).unchanged).toEqual(["ping"]);
	});
});
