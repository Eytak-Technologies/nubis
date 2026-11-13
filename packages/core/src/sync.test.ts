import { describe, expect, test } from "bun:test";
import {
	type APIApplicationCommand,
	ApplicationCommandOptionType as Opt,
	ApplicationCommandType,
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

	test("leaves context menu commands alone", () => {
		const menu = remote("9", local("Report"), ApplicationCommandType.Message);
		const plan = planSync([], [menu]);
		expect(plan.remove).toEqual([]);
	});
});
