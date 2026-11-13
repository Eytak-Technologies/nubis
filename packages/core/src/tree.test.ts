import { describe, expect, test } from "bun:test";
import {
	buildCommandTree,
	type CommandFile,
	command,
	NubisError,
} from "./index";

const def = (description = "A command") =>
	command({ description, run: () => {} });
const file = (...path: string[]): CommandFile => ({ path, definition: def() });

describe("buildCommandTree", () => {
	test("files become commands, folders become subcommands and groups", () => {
		const tree = buildCommandTree([
			file("ping"),
			file("config", "show"),
			file("config", "role", "add"),
		]);

		expect(tree.get("ping")?.type).toBe("command");
		const config = tree.get("config");
		expect(config?.type).toBe("parent");
		if (config?.type !== "parent") return;
		expect(config.children.get("show")?.type).toBe("command");
		const role = config.children.get("role");
		expect(role?.type).toBe("parent");
		expect(role?.path).toEqual(["config", "role"]);
	});

	test("a command can't also have subcommands, in either order", () => {
		expect(() =>
			buildCommandTree([file("config"), file("config", "set")]),
		).toThrow(/is a command, so it can't also have subcommands/);
		expect(() =>
			buildCommandTree([file("config", "set"), file("config")]),
		).toThrow(/has subcommands, so it can't also be a command/);
	});

	test("rejects duplicates, deep nesting and invalid names", () => {
		expect(() => buildCommandTree([file("ping"), file("ping")])).toThrow(
			/defined twice/,
		);
		expect(() => buildCommandTree([file("a", "b", "c", "d")])).toThrow(
			/at most 3 levels/,
		);
		expect(() => buildCommandTree([file("Ping")])).toThrow(NubisError);
		expect(() => buildCommandTree([file("has space")])).toThrow(
			/not a valid Discord command/,
		);
	});

	test("accepts non-Latin names Discord allows", () => {
		expect(buildCommandTree([file("yardım")]).has("yardım")).toBe(true);
	});
});
