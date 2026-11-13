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
		expect(runCli([])).toMatchObject({
			code: 0,
			output: expect.stringContaining("Usage: nubis <command>"),
		});
	});

	test("hands Discord commands to the runner with their arguments", () => {
		expect(runCli(["sync", "--global"])).toEqual({
			run: "sync",
			args: ["--global"],
		});
		expect(runCli(["dev"])).toEqual({ run: "dev", args: [] });
		expect(runCli(["start"])).toEqual({ run: "start", args: [] });
	});

	test("rejects unknown commands", () => {
		expect(runCli(["deploy"])).toMatchObject({ code: 1 });
	});
});
