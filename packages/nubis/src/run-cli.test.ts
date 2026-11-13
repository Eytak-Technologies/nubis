import { describe, expect, test } from "bun:test";
import pkg from "../package.json" with { type: "json" };
import { command, option } from "./index";
import { runCli } from "./run-cli";

describe("nubis", () => {
	test("re-exports the core API", () => {
		expect(typeof command).toBe("function");
		expect(typeof option.string).toBe("function");
	});

	test("prints its version", () => {
		expect(runCli(["--version"])).toEqual({ code: 0, output: pkg.version });
	});

	test("prints help with no arguments", () => {
		const result = runCli([]);
		expect(result.code).toBe(0);
		expect(result.output).toContain("Usage: nubis <command>");
	});

	test("rejects unknown commands", () => {
		expect(runCli(["deploy"]).code).toBe(1);
	});
});
