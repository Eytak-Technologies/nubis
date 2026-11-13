// Publishes every package whose version isn't on npm yet.
//
// `changeset publish` would run `npm publish` in each package, and npm leaves
// Bun's `workspace:*` dependencies as they are, which breaks installs. So each
// package is packed with `bun pm pack` (which writes the real versions in) and
// the tarball is published with npm, which also handles provenance and npm's
// trusted publishing.
//
// Prints "New tag: <name>@<version>" per package, which changesets/action
// reads to create git tags and GitHub releases.

import { mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const dryRun = process.argv.includes("--dry-run");
const provenance = process.env.NPM_PROVENANCE === "true";

interface Manifest {
	name: string;
	version: string;
	private?: boolean;
}

async function isPublished(name: string, version: string): Promise<boolean> {
	const response = await fetch(
		`https://registry.npmjs.org/${name.replace("/", "%2f")}/${version}`,
	);
	return response.ok;
}

// The terminal is handed straight to each command. npm asks for two-factor
// approval (a browser link, or a code) only when it is attached to one: with
// its output captured, it fails with EOTP instead of waiting.
async function run(command: string[], cwd: string): Promise<void> {
	const process = Bun.spawn(command, {
		cwd,
		stdin: "inherit",
		stdout: "inherit",
		stderr: "inherit",
	});
	if ((await process.exited) !== 0) {
		throw new Error(`${command.join(" ")} failed in ${cwd}`);
	}
}

const outDir = await mkdtemp(join(tmpdir(), "nubis-publish-"));
let published = 0;

// Dependencies first, so no published package ever points at a version that
// isn't on npm yet, even if a later publish fails.
const ORDER = ["core", "testing", "nubis", "create-nubis"];
const rank = (dir: string) =>
	ORDER.includes(dir) ? ORDER.indexOf(dir) : ORDER.length;
const dirs = (await readdir(join(root, "packages"))).sort(
	(a, b) => rank(a) - rank(b) || a.localeCompare(b),
);

for (const dir of dirs) {
	const cwd = join(root, "packages", dir);
	const manifest = JSON.parse(
		await readFile(join(cwd, "package.json"), "utf8"),
	) as Manifest;
	const { name, version } = manifest;

	// 0.0.0 is the placeholder the names were reserved with, never a release.
	if (manifest.private || version === "0.0.0") continue;
	if (await isPublished(name, version)) {
		console.log(`${name}@${version} is already on npm`);
		continue;
	}

	await run(["bun", "pm", "pack", "--destination", outDir], cwd);
	const tarball = join(
		outDir,
		`${name.replace("@", "").replace("/", "-")}-${version}.tgz`,
	);
	const tag = version.includes("-") ? "next" : "latest";
	const command = [
		"npm",
		"publish",
		tarball,
		"--access",
		"public",
		"--tag",
		tag,
		...(provenance ? ["--provenance"] : []),
		...(dryRun ? ["--dry-run"] : []),
	];
	console.log(`$ ${command.join(" ")}`);
	await run(command, cwd);
	console.log(`New tag: ${name}@${version}`);
	published++;
}

console.log(
	published === 0
		? "Nothing to publish."
		: `Published ${published} package(s)${dryRun ? " (dry run)" : ""}.`,
);
