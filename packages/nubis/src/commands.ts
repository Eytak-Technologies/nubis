import { type ChildProcess, spawn } from "node:child_process";
import { watch } from "node:fs";
import { relative, sep } from "node:path";
import { REST } from "@discordjs/rest";
import { createBot } from "./bot";
import { discordEnv, loadEnv } from "./env";
import { intentNames, PRIVILEGED_INTENTS } from "./intents";
import { loadProject } from "./loader";
import { describePlan, hasChanges, syncCommands } from "./sync";

const log = (message: string) => console.log(`[nubis] ${message}`);
const fail = (error: unknown) =>
	console.error(
		`[nubis] ${error instanceof Error ? error.message : String(error)}`,
	);

async function setup(cwd: string) {
	await loadEnv(cwd);
	const env = discordEnv();
	const rest = new REST({ version: "10" }).setToken(env.token);
	return { env, rest };
}

/** `nubis sync [--global] [--dry-run]` */
export async function runSync(
	cwd: string,
	args: readonly string[],
): Promise<number> {
	const { env, rest } = await setup(cwd);
	const global = args.includes("--global");
	const guildId = global ? undefined : env.devGuildId;
	if (!global && !guildId) {
		throw new Error(
			"Set DISCORD_DEV_GUILD_ID to sync to your test server, or pass --global to register commands everywhere.",
		);
	}
	const project = await loadProject(cwd);
	const result = await syncCommands({
		rest,
		applicationId: env.applicationId,
		project,
		guildId,
		dryRun: args.includes("--dry-run"),
	});
	const lines = describePlan(result.plan);
	log(
		hasChanges(result.plan)
			? `${result.applied ? "Synced" : "Would sync"} ${result.scope} commands:\n${lines.join("\n")}`
			: `Commands are up to date (${result.plan.unchanged.length}).`,
	);
	return 0;
}

/** `nubis start`: runs the bot until it's stopped. */
export async function runStart(cwd: string): Promise<number> {
	const { env } = await setup(cwd);
	const project = await loadProject(cwd);
	const bot = createBot({
		token: env.token,
		project,
		onError: (error, info) => {
			console.error(`[nubis] ${info.kind} ${info.name} threw:`, error);
		},
	});
	const privileged = intentNames(bot.intents & PRIVILEGED_INTENTS);
	if (privileged.length > 0) {
		log(
			`Using privileged intents (${privileged.join(", ")}): they must be switched on in the Developer Portal, under Bot.`,
		);
	}
	const stop = async () => {
		await bot.stop();
		process.exit(0);
	};
	process.once("SIGINT", stop);
	process.once("SIGTERM", stop);
	await bot.start();
	log(
		`Online: ${project.tree.size} commands, ${project.components.size} components, ${project.menus.length} menus.`,
	);
	// The gateway connection keeps the process alive.
	return new Promise<number>(() => {});
}

const IGNORED = ["node_modules", ".git", "dist", ".turbo"];

/**
 * `nubis dev`: syncs commands to the test server and runs the bot, then does
 * both again whenever a file changes. Each run is a fresh process, so edits
 * to helpers are picked up too, not just the files the loader imports.
 */
export async function runDev(cwd: string): Promise<number> {
	const { env, rest } = await setup(cwd);
	if (!env.devGuildId) {
		throw new Error(
			"nubis dev needs DISCORD_DEV_GUILD_ID: commands go to your test server, where they show up instantly.",
		);
	}
	let child: ChildProcess | undefined;

	const stopChild = () =>
		new Promise<void>((resolve) => {
			if (!child || child.exitCode !== null) return resolve();
			child.once("exit", () => resolve());
			child.kill("SIGTERM");
		});

	const cycle = async () => {
		await stopChild();
		try {
			const project = await loadProject(cwd, { version: Date.now() });
			const result = await syncCommands({
				rest,
				applicationId: env.applicationId,
				project,
				guildId: env.devGuildId,
			});
			if (result.applied)
				log(`Synced commands:\n${describePlan(result.plan).join("\n")}`);
		} catch (error) {
			fail(error);
			log("Fix the error and save; I'll try again.");
			return;
		}
		child = spawn(process.execPath, [process.argv[1] ?? "", "start"], {
			cwd,
			stdio: "inherit",
			env: process.env,
		});
	};

	let timer: ReturnType<typeof setTimeout> | undefined;
	watch(cwd, { recursive: true }, (_event, file) => {
		if (!file) return;
		const parts = relative(cwd, `${cwd}${sep}${file}`).split(sep);
		if (parts.some((part) => IGNORED.includes(part) || part.startsWith(".")))
			return;
		clearTimeout(timer);
		timer = setTimeout(() => {
			log(`${file} changed, restarting.`);
			void cycle();
		}, 150);
	});

	process.once("SIGINT", async () => {
		await stopChild();
		process.exit(0);
	});

	log("Watching for changes. Press Ctrl+C to stop.");
	await cycle();
	return new Promise<number>(() => {});
}
