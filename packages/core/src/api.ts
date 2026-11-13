import { NubisError } from "./errors";

/**
 * The Discord API client handlers get as `api`. Empty here so core stays
 * free of any HTTP library; the `nubis` package fills it in with
 * @discordjs/core's typed API through module augmentation:
 *
 *     declare module "@nubisjs/core" { interface NubisApi extends API {} }
 */
// biome-ignore lint/suspicious/noEmptyInterface: filled in by module augmentation
export interface NubisApi {}

/**
 * Stands in when no API client was given: any use explains how to get one,
 * instead of failing with "cannot read properties of undefined".
 */
export function missingApi(): NubisApi {
	return new Proxy(
		{},
		{
			get(_target, key) {
				// Lets the proxy pass through `await` and inspection unharmed.
				if (key === "then" || typeof key === "symbol") return undefined;
				throw new NubisError(
					`This bot has no Discord API client, so api.${String(key)} isn't available. Bots run with nubis start or createBot() have one; for the HTTP endpoint, pass \`api\`; in tests, pass a fake with .with({ api }).`,
				);
			},
		},
	) as NubisApi;
}
