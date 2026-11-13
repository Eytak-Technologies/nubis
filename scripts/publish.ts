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

async function run(command: string[], cwd: string): Promise<string> {
	const process = Bun.spawn(command, {
		cwd,
		stdout: "pipe",
		stderr: "inherit",
	});
	const output = await new Response(process.stdout).text();
	if ((await process.exited) !== 0) {
		throw new Error(`${command.join(" ")} failed in ${cwd}`);
	}
	return output;
}

const outDir = await mkdtemp(join(tmpdir(), "nubis-publish-"));
let published = 0;

for (const dir of (await readdir(join(root, "packages"))).sort()) {
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
