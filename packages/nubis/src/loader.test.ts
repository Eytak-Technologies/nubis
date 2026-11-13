import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { NubisError, toCommandPayloads, toMenuPayloads } from "@nubisjs/core";
import { loadProject } from "./node";

const fixture = join(import.meta.dir, "__fixtures__", "project");

describe("loadProject", () => {
	test("reads commands, folders, components, menus and events", async () => {
		const project = await loadProject(fixture);

		expect([...project.tree.keys()]).toEqual(["admin", "ping"]);
		const [admin, ping] = toCommandPayloads(project.tree);
		expect(ping).toMatchObject({
			name: "ping",
			description: "Replies with pong",
		});
		expect(admin).toMatchObject({
			name: "admin",
			description: "Server admin tools",
			options: [{ name: "kick", description: "Kick a member" }],
		});

		expect([...project.components.keys()].sort()).toEqual([
			"open-report",
			"report-form",
		]);
		expect(toMenuPayloads(project.menus)).toEqual([
			{ type: 2, name: "View profile" },
		]);
		expect(project.events.get("guildMemberAdd")).toHaveLength(1);
		expect(project.events.get("guildMemberRemove")).toHaveLength(1);
	});

	test("skips helpers, tests and declarations, and lists what it loaded", async () => {
		const { files } = await loadProject(fixture);
		expect(files).toEqual([
			join("commands", "admin", "_folder.ts"),
			join("commands", "admin", "kick.ts"),
			join("commands", "ping.ts"),
			join("components", "report.ts"),
			join("menus", "view-profile.ts"),
			join("events", "members.ts"),
		]);
	});

	test("folder settings reach the commands inside", async () => {
		const project = await loadProject(fixture);
		const admin = project.tree.get("admin");
		expect(admin?.type === "parent" && admin.folder?.guards?.length).toBe(1);
	});

	test("missing folders are fine", async () => {
		const empty = await mkdtemp(join(tmpdir(), "nubis-empty-"));
		const project = await loadProject(empty);
		expect(project.tree.size).toBe(0);
		expect(project.files).toEqual([]);
	});
});

describe("loadProject errors name the file", () => {
	const project = async (files: Record<string, string>) => {
		const root = await mkdtemp(join(tmpdir(), "nubis-bad-"));
		for (const [path, content] of Object.entries(files)) {
			await mkdir(dirname(join(root, path)), { recursive: true });
			await writeFile(join(root, path), content);
		}
		return root;
	};

	test("a command file without a default command", async () => {
		const root = await project({
			"commands/ping.ts": "export const ping = 1;",
		});
		const loading = loadProject(root);
		await expect(loading).rejects.toThrow(NubisError);
		await expect(loading).rejects.toThrow(
			/commands\/ping\.ts: export a command as default/,
		);
	});

	test("a components file without components", async () => {
		const root = await project({ "components/util.ts": "export const x = 1;" });
		await expect(loadProject(root)).rejects.toThrow(
			/components\/util\.ts: no buttons, selects or modals/,
		);
	});

	test("a menu or event file with the wrong export", async () => {
		const menus = await project({
			"menus/x.ts": "export default { kind: 'command' };",
		});
		await expect(loadProject(menus)).rejects.toThrow(
			/menus\/x\.ts: export a context menu/,
		);

		const events = await project({ "events/x.ts": "export default [];" });
		await expect(loadProject(events)).rejects.toThrow(
			/events\/x\.ts: export an event/,
		);
	});

	test("files with other extensions are ignored", async () => {
		const root = await project({ "commands/notes.md": "# not code" });
		expect((await loadProject(root)).files).toEqual([]);
	});
});
