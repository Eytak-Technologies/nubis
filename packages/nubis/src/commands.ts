import { type ChildProcess, spawn } from "node:child_process";
import { watch } from "node:fs";
import { createServer, type Server } from "node:http";
import { relative, sep } from "node:path";
import { API } from "@discordjs/core/http-only";
import { REST } from "@discordjs/rest";
import type { ErrorHandler, NubisApi } from "@nubisjs/core";
import { createBot } from "./bot";
import { intentBits, type NubisConfig, presenceData } from "./config";
import { loadConfig } from "./config-loader";
import { discordEnv, loadEnv } from "./env";
import { createInteractionHandler } from "./http";
import { intentNames, PRIVILEGED_INTENTS } from "./intents";
import { loadProject, type Project } from "./loader";
import { toNodeListener } from "./node-listener";
import type { RouteOptions } from "./route";
import { describePlan, hasChanges, syncCommands } from "./sync";

const log = (message: string) => console.log(`[nubis] ${message}`);
const fail = (error: unknown) =>
	console.error(
		`[nubis] ${error instanceof Error ? error.message : String(error)}`,
	);

const logErrors: ErrorHandler = (error, info) => {
	console.error(`[nubis] ${info.kind} ${info.name} threw:`, error);
};

async function setup(cwd: string) {
	await loadEnv(cwd);
	const env = discordEnv();
	const rest = new REST({ version: "10" }).setToken(env.token);
	const loaded = await loadConfig(cwd);
	return {
		env,
		rest,
		...loaded,
		devGuildId: env.devGuildId ?? loaded.config.devGuildId,
	};
}

/** The dispatch options a config asks for, shared by both transports. */
export function routeOptionsFor(
	config: NubisConfig,
	api: NubisApi,
): RouteOptions {
	return {
		api,
		guards: config.guards,
		middleware: config.middleware,
		autoDeferMs: config.autoDeferMs,
		onError: config.onError ?? logErrors,
	};
}

/** `nubis sync [--global] [--dry-run]` */
export async function runSync(
	cwd: string,
	args: readonly string[],
): Promise<number> {
	const { env, rest, root, devGuildId } = await setup(cwd);
	const global = args.includes("--global");
	const guildId = global ? undefined : devGuildId;
	if (!global && !guildId) {
		throw new Error(
			"Set DISCORD_DEV_GUILD_ID (or devGuildId in nubis.config.ts) to sync to your test server, or pass --global to register commands everywhere.",
		);
	}
	const project = await loadProject(root);
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

/** Serves the project as an Interactions Endpoint URL. Exported for tests. */
export function createHttpServer(options: {
	readonly publicKey: string;
	readonly project: Project;
	readonly config: NubisConfig;
	readonly api: NubisApi;
}): Server {
	const path = options.config.http?.path ?? "/interactions";
	const handle = createInteractionHandler({
		publicKey: options.publicKey,
		project: options.project,
		dispatch: routeOptionsFor(options.config, options.api),
	});
	return createServer(
		toNodeListener(async (request) =>
			new URL(request.url).pathname === path
				? handle(request)
				: new Response("Not found", { status: 404 }),
		),
	);
}

/** `nubis start`: runs the bot until it's stopped. */
export async function runStart(cwd: string): Promise<number> {
	const { env, rest, config, root } = await setup(cwd);
	const project = await loadProject(root);
	const counts = `${project.tree.size} commands, ${project.components.size} components, ${project.menus.length} menus`;

	if (config.transport === "http") {
		if (!env.publicKey) {
			throw new Error(
				"The HTTP transport needs DISCORD_PUBLIC_KEY to verify Discord's requests.",
			);
		}
		if (project.events.size > 0) {
			log(
				"HTTP bots don't receive gateway events; the handlers in events/ won't run.",
			);
		}
		const port = config.http?.port ?? Number(process.env.PORT ?? 3000);
		const server = createHttpServer({
			publicKey: env.publicKey,
			project,
			config,
			api: new API(rest) as NubisApi,
		});
		server.listen(port);
		log(
			`Listening on http://localhost:${port}${config.http?.path ?? "/interactions"} (${counts}). Set it as the Interactions Endpoint URL in the Developer Portal.`,
		);
		return new Promise<number>(() => {});
	}

	const bot = createBot({
		token: env.token,
		project,
		rest,
		intents: intentBits(config.intents),
		presence: presenceData(config.presence),
		// The bot adds its own `api` client to these.
		dispatch: {
			guards: config.guards,
			middleware: config.middleware,
			autoDeferMs: config.autoDeferMs,
		},
		onError: config.onError ?? logErrors,
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
	log(`Online: ${counts}.`);
	// The gateway connection keeps the process alive.
	return new Promise<number>(() => {});
}

const IGNORED = ["node_modules", ".git", "dist", ".turbo"];

/**
 * `nubis dev`: syncs commands to the test server and runs the bot, then does
 * both again whenever a file changes, nubis.config.ts included. Each run is
 * a fresh process, so edits to helpers are picked up too.
 */
export async function runDev(cwd: string): Promise<number> {
	const { env, rest, devGuildId } = await setup(cwd);
	if (!devGuildId) {
		throw new Error(
			"nubis dev needs a test server: set DISCORD_DEV_GUILD_ID (or devGuildId in nubis.config.ts). Commands go there and show up instantly.",
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
			const { root } = await loadConfig(cwd);
			const project = await loadProject(root, { version: Date.now() });
			const result = await syncCommands({
				rest,
				applicationId: env.applicationId,
				project,
				guildId: devGuildId,
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
