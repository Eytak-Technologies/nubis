import {
	type AnyCommandPayload,
	planSync,
	type SyncPlan,
	toCommandPayloads,
	toMenuPayloads,
} from "@nubisjs/core";
import { type APIApplicationCommand, Routes } from "discord-api-types/v10";
import type { Project } from "./loader";
import type { RestLike } from "./rest-transport";

export interface SyncOptions {
	readonly rest: RestLike;
	readonly applicationId: string;
	readonly project: Pick<Project, "tree" | "menus">;
	/** Register to one server (instant; for development) instead of globally. */
	readonly guildId?: string;
	/** Work out the plan without changing anything. */
	readonly dryRun?: boolean;
}

export interface SyncResult {
	readonly plan: SyncPlan;
	/** Whether Discord was updated: false for a dry run or when nothing changed. */
	readonly applied: boolean;
	readonly scope: "guild" | "global";
}

export const hasChanges = (plan: SyncPlan): boolean =>
	plan.create.length + plan.update.length + plan.remove.length > 0;

/**
 * Makes Discord's registered commands match the project's. Compares first,
 * so an unchanged bot makes no write; changes go in one bulk overwrite.
 */
export async function syncCommands(options: SyncOptions): Promise<SyncResult> {
	const route = options.guildId
		? Routes.applicationGuildCommands(options.applicationId, options.guildId)
		: Routes.applicationCommands(options.applicationId);
	const local: AnyCommandPayload[] = [
		...toCommandPayloads(options.project.tree),
		...toMenuPayloads(options.project.menus),
	];
	const remote = (await options.rest.get(route)) as APIApplicationCommand[];
	const plan = planSync(local, remote);
	const scope = options.guildId ? "guild" : "global";

	if (options.dryRun || !hasChanges(plan))
		return { plan, applied: false, scope };
	await options.rest.put(route, { body: local });
	return { plan, applied: true, scope };
}

/** One line per change, for the CLI. */
export function describePlan(plan: SyncPlan): string[] {
	return [
		...plan.create.map((command) => `+ ${command.name}`),
		...plan.update.map(({ payload }) => `~ ${payload.name}`),
		...plan.remove.map((command) => `- ${command.name}`),
	];
}
