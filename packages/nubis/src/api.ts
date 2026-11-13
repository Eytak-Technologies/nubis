import type { API } from "@discordjs/core/http-only";

/**
 * Handlers' `api` is @discordjs/core's typed client: `api.channels.createMessage`,
 * `api.guilds.banUser`, and the rest of Discord's REST API, rate limits handled.
 * Core declares NubisApi empty so it doesn't depend on an HTTP library; this
 * fills it in for everyone who imports `nubis`.
 */
declare module "@nubisjs/core" {
	interface NubisApi extends API {}
}

export type { API } from "@discordjs/core/http-only";
