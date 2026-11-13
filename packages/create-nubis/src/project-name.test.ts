import { describe, expect, test } from "bun:test";
import { resolveProjectName } from "./project-name";

describe("resolveProjectName", () => {
	test("defaults to my-bot", () => {
		expect(resolveProjectName([])).toBe("my-bot");
	});

	test("skips flags and takes the first name", () => {
		expect(resolveProjectName(["--yes", "ticket-bot"])).toBe("ticket-bot");
	});

	test("rejects invalid package names", () => {
		expect(() => resolveProjectName(["My Bot"])).toThrow();
	});
});
