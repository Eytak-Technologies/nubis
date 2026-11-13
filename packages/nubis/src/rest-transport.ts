import { NubisError, type ReplyFile, type Transport } from "@nubisjs/core";
import { type APIInteraction, Routes } from "discord-api-types/v10";

/** The slice of @discordjs/rest's REST client Nubis uses. */
export interface RestLike {
	get(route: `/${string}`, options?: object): Promise<unknown>;
	post(route: `/${string}`, options?: object): Promise<unknown>;
	put(route: `/${string}`, options?: object): Promise<unknown>;
	patch(route: `/${string}`, options?: object): Promise<unknown>;
	delete(route: `/${string}`, options?: object): Promise<unknown>;
}

// Discord's error codes for an interaction token that's gone.
const EXPIRED = new Set([10015, 10062, 50027]);

async function toRawFiles(files: readonly ReplyFile[] | undefined) {
	if (!files?.length) return undefined;
	return Promise.all(
		files.map(async (file, index) => ({
			key: `files[${index}]`,
			name: file.name,
			contentType: file.contentType,
			data:
				typeof file.data === "string" || file.data instanceof Uint8Array
					? file.data
					: file.data instanceof ArrayBuffer
						? new Uint8Array(file.data)
						: new Uint8Array(await file.data.arrayBuffer()),
		})),
	);
}

function explain(error: unknown, what: string): unknown {
	const code = (error as { code?: unknown }).code;
	if (typeof code === "number" && EXPIRED.has(code)) {
		return new NubisError(
			`${what} failed: the interaction token has expired. Discord allows follow-ups and edits for 15 minutes after an interaction.`,
		);
	}
	return error;
}

/**
 * Answers an interaction received over the gateway, through Discord's REST
 * API. Interaction callbacks and webhooks use the interaction's own token,
 * so these calls don't send the bot token.
 */
export function restTransport(
	rest: RestLike,
	interaction: APIInteraction,
): Transport {
	const { id, token, application_id: applicationId } = interaction;
	const call = async (
		what: string,
		send: () => Promise<unknown>,
	): Promise<void> => {
		try {
			await send();
		} catch (error) {
			throw explain(error, what);
		}
	};

	return {
		respond: async (response, files) =>
			call("Responding", async () =>
				rest.post(Routes.interactionCallback(id, token), {
					auth: false,
					body: response,
					files: await toRawFiles(files),
				}),
			),
		editOriginal: async (body, files) =>
			call("Editing the reply", async () =>
				rest.patch(Routes.webhookMessage(applicationId, token, "@original"), {
					auth: false,
					body,
					files: await toRawFiles(files),
				}),
			),
		deleteOriginal: () =>
			call("Deleting the reply", () =>
				rest.delete(Routes.webhookMessage(applicationId, token, "@original"), {
					auth: false,
				}),
			),
		followUp: async (body, files) =>
			call("Sending a follow-up", async () =>
				rest.post(Routes.webhook(applicationId, token), {
					auth: false,
					body,
					files: await toRawFiles(files),
				}),
			),
	};
}
