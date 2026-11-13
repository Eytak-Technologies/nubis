#!/usr/bin/env node
import { resolveProjectName } from "./project-name";

try {
	const name = resolveProjectName(process.argv.slice(2));
	console.log(
		`Nubis is still in development, so create-nubis can't scaffold "${name}" yet.\nFollow along at https://github.com/Eytak-Technologies/nubis`,
	);
} catch (error) {
	console.error(error instanceof Error ? error.message : error);
	process.exitCode = 1;
}
