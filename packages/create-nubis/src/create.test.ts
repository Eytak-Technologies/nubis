import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { toCommandPayloads } from "nubis";
import { loadProject } from "nubis/node";
import { testCommand, testComponent } from "nubis/testing";
import { createProject, detectPackageManager, nubisRange } from "./create";

const nubisPackage = dirname(require.resolve("nubis/package.json"));

async function generate(packageManager: "bun" | "npm") {
	const dir = join(await mkdtemp(join(tmpdir(), "create-nubis-")), "my-bot");
	const files = await createProject(dir, {
		name: "my-bot",
		packageManager,
		nubisVersion: "^0.1.0",
	});
	return { dir, files };
}

describe("createProject", () => {
	test("writes a complete bot", async () => {
		const { files } = await generate("bun");
		expect(files.sort()).toEqual([
			".env.example",
			".gitignore",
			"README.md",
			"commands/counter.ts",
			"commands/echo.ts",
			"commands/fun/_folder.ts",
			"commands/fun/roll.ts",
			"commands/ping.ts",
			"components/counter.ts",
			"events/ready.ts",
			"nubis.config.ts",
			"package.json",
			"tests/commands.test.ts",
			"tsconfig.json",
		]);
	});

	test("fits the package manager: Bun tests with bun:test, others with Vitest", async () => {
		const bun = await generate("bun");
		const npm = await generate("npm");
		const manifest = async (dir: string) =>
			JSON.parse(await readFile(join(dir, "package.json"), "utf8"));

		expect((await manifest(bun.dir)).scripts.test).toBe("bun test");
		expect((await manifest(npm.dir)).scripts.test).toBe("vitest run");
		// Every script runs a nubis command that exists; a Bun project runs the
		// CLI under Bun, a Node one needs a Node that runs .ts files.
		for (const [project, cli] of [
			[bun, "bun --bun nubis"],
			[npm, "nubis"],
		] as const) {
			const { scripts } = await manifest(project.dir);
			expect(scripts.dev).toBe(`${cli} dev`);
			expect(scripts.start).toBe(`${cli} start`);
			expect(scripts.sync).toBe(`${cli} sync --global`);
			expect(scripts.build).toBeUndefined();
		}
		expect((await manifest(npm.dir)).engines).toEqual({ node: ">=22.18" });
		expect((await manifest(bun.dir)).engines).toBeUndefined();
		// Imports between the bot's own files name the .ts file.
		const counter = await readFile(
			join(bun.dir, "commands/counter.ts"),
			"utf8",
		);
		expect(counter).toContain('from "../components/counter.ts"');
		expect((await manifest(npm.dir)).devDependencies.vitest).toBeDefined();
		expect(
			await readFile(join(bun.dir, "tests/commands.test.ts"), "utf8"),
		).toContain('from "bun:test"');
		expect(
			await readFile(join(npm.dir, "tests/commands.test.ts"), "utf8"),
		).toContain('from "vitest"');
		expect(await readFile(join(npm.dir, "README.md"), "utf8")).toContain(
			"`npm run test`",
		);
	});

	test("refuses a folder that isn't empty", async () => {
		const dir = await mkdtemp(join(tmpdir(), "create-nubis-full-"));
		await writeFile(join(dir, "keep.txt"), "mine");
		await expect(
			createProject(dir, {
				name: "x",
				packageManager: "npm",
				nubisVersion: "latest",
			}),
		).rejects.toThrow(/isn't empty/);
	});

	test("the generated bot loads and its commands work", async () => {
		const { dir } = await generate("bun");
		// Point the new project at this repo's nubis, as an install would.
		await mkdir(join(dir, "node_modules"), { recursive: true });
		await symlink(nubisPackage, join(dir, "node_modules", "nubis"), "dir");

		const project = await loadProject(dir);
		const names = toCommandPayloads(project.tree).map(
			(payload) => payload.name,
		);
		expect(names.sort()).toEqual(["counter", "echo", "fun", "ping"]);
		expect(project.events.get("ready")).toHaveLength(1);

		const ping = project.tree.get("ping");
		const echo = project.tree.get("echo");
		if (ping?.type !== "command" || echo?.type !== "command")
			throw new Error("missing commands");
		expect((await testCommand(ping.definition).run({})).replies).toEqual([
			"Pong!",
		]);
		expect(
			(await testCommand(echo.definition).run({ text: "hi" } as never)).replies,
		).toEqual(["hi"]);

		const counter = project.components.get("counter");
		expect(counter).toBeDefined();
		const counterModule = await import(join(dir, "components/counter.ts"));
		const clicked = await testComponent(counterModule.counter).click({
			count: 1,
		});
		expect(clicked.replies).toEqual(["Clicked 2 times"]);
	});
});

describe("helpers", () => {
	test("detects the package manager from npm_config_user_agent", () => {
		expect(detectPackageManager("bun/1.4.4 npm/? node/v24")).toBe("bun");
		expect(detectPackageManager("pnpm/10.0.0 npm/? node/v22")).toBe("pnpm");
		expect(detectPackageManager("npm/11.0.0 node/v24")).toBe("npm");
		expect(detectPackageManager(undefined)).toBe("npm");
	});

	test("depends on the matching nubis release, or latest while developing", () => {
		expect(nubisRange("0.1.0")).toBe("^0.1.0");
		expect(nubisRange("0.0.0")).toBe("latest");
	});
});
