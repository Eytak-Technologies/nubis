import { describe, expect, test } from "bun:test";
import {
	type APIApplicationCommand,
	ApplicationCommandType,
	ApplicationCommandOptionType as Opt,
} from "discord-api-types/v10";
import { type CommandPayload, planSync } from "./index";

const local = (name: string, description = name): CommandPayload => ({
	type: ApplicationCommandType.ChatInput,
	name,
	description,
	options: [
		{ type: Opt.String, name: "text", description: "text", required: false },
	],
});

// What Discord sends back: our fields plus ids, versions and defaults.
const remote = (
	id: string,
	payload: CommandPayload,
	type = ApplicationCommandType.ChatInput,
): APIApplicationCommand =>
	({
		id,
		application_id: "app",
		version: "1",
		default_member_permissions: null,
		name_localizations: null,
		...payload,
		type,
		options: payload.options?.map(
			({ required: _required, ...option }) => option,
		),
	}) as APIApplicationCommand;

describe("planSync", () => {
	test("sorts commands into create, update, remove and unchanged", () => {
		const plan = planSync(
			[local("ping"), local("ban", "Ban a member (new)"), local("new")],
			[
				remote("1", local("ping")),
				remote("2", local("ban", "Ban a member")),
				remote("3", local("old")),
			],
		);

		expect(plan.create.map((c) => c.name)).toEqual(["new"]);
		expect(plan.update).toEqual([
			{ id: "2", payload: local("ban", "Ban a member (new)") },
		]);
		expect(plan.remove).toEqual([{ id: "3", name: "old" }]);
		expect(plan.unchanged).toEqual(["ping"]);
	});

	test("manages context menus too, keyed by type and name", () => {
		const menu = remote("9", local("Report"), ApplicationCommandType.Message);
		const sameNameSlash = remote("8", local("report"));
		const plan = planSync([local("report")], [menu, sameNameSlash]);
		expect(plan.unchanged).toEqual(["report"]);
		expect(plan.remove).toEqual([{ id: "9", name: "Report" }]);
	});

	test("install types: unset matches either app default, set is compared as written", () => {
		const withTypes = (types: number[] | undefined) => ({
			...remote("2", local("ping")),
			integration_types: types,
		});
		// An app installable to users reports [0, 1] for commands that never set it.
		expect(planSync([local("ping")], [withTypes([0, 1])]).unchanged).toEqual([
			"ping",
		]);
		expect(planSync([local("ping")], [withTypes([0])]).unchanged).toEqual([
			"ping",
		]);
		expect(planSync([local("ping")], [withTypes(undefined)]).unchanged).toEqual(
			["ping"],
		);
		// Set to user-only on Discord but unset in code: the code wins.
		expect(planSync([local("ping")], [withTypes([1])]).update).toHaveLength(1);

		const guildAndUser = { ...local("ping"), integration_types: [0, 1] };
		expect(planSync([guildAndUser], [withTypes([1, 0])]).unchanged).toEqual([
			"ping",
		]);
		// Asked for user installs, Discord still guild-only: an update.
		expect(planSync([guildAndUser], [withTypes([0])]).update).toHaveLength(1);
	});

	test("leaves activity entry point commands alone", () => {
		const entry = remote(
			"7",
			local("launch"),
			ApplicationCommandType.PrimaryEntryPoint,
		);
		expect(planSync([], [entry]).remove).toEqual([]);
	});
});
