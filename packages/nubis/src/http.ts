import { NubisError, type ReplyFile, type Transport } from "@nubisjs/core";
import {
	type APIInteraction,
	type APIInteractionResponse,
	type APIInteractionResponseCallbackData,
	InteractionResponseType,
	InteractionType,
} from "discord-api-types/v10";
import {
	type InteractionProject,
	type RouteOptions,
	routeInteraction,
} from "./route";

export type { InteractionProject } from "./route";

export interface InteractionHandlerOptions {
	/** The application's public key from the Developer Portal (hex). */
	readonly publicKey: string;
	readonly project: InteractionProject;
	/** Guards, middleware and auto-defer settings for every interaction. */
	readonly dispatch?: RouteOptions;
	/**
	 * Keeps work alive after the HTTP response is sent (follow-ups, edits).
	 * Serverless platforms provide this, e.g. `ctx.waitUntil` on Workers.
	 */
	readonly waitUntil?: (work: Promise<unknown>) => void;
	/** Called once an interaction has been fully handled, for logging. */
	readonly onResult?: (result: InteractionResult) => void;
	/** Discord's API base. Defaults to https://discord.com/api/v10. */
	readonly api?: string;
	/** Swappable in tests. */
	readonly fetch?: typeof fetch;
}

export type InteractionResult = {
	readonly interaction: APIInteraction;
	readonly status: string;
	readonly error?: unknown;
};

const DEFAULT_API = "https://discord.com/api/v10";

// ---------------------------------------------------------------- signatures

const hexToBytes = (hex: string): Uint8Array | undefined => {
	if (hex.length % 2 !== 0 || /[^0-9a-f]/i.test(hex)) return undefined;
	const bytes = new Uint8Array(hex.length / 2);
	for (let i = 0; i < bytes.length; i++) {
		bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
	}
	return bytes;
};

// Spelled this way because the build has Node's types but not the DOM's.
type PublicKey = Awaited<ReturnType<typeof crypto.subtle.importKey>>;

const keyCache = new Map<string, Promise<PublicKey>>();

function importPublicKey(publicKey: string): Promise<PublicKey> {
	let key = keyCache.get(publicKey);
	if (!key) {
		const raw = hexToBytes(publicKey);
		if (!raw || raw.length !== 32) {
			throw new NubisError(
				"The public key must be the 64 hex characters shown in the Developer Portal.",
			);
		}
		key = crypto.subtle.importKey("raw", raw, { name: "Ed25519" }, false, [
			"verify",
		]);
		keyCache.set(publicKey, key);
	}
	return key;
}

/**
 * Checks Discord's Ed25519 signature on an interaction request. Discord
 * sends test requests with bad signatures and disables the endpoint if they
 * aren't rejected, so this must run before anything else.
 */
export async function verifyDiscordRequest(
	publicKey: string,
	signature: string,
	timestamp: string,
	body: string,
): Promise<boolean> {
	const signatureBytes = hexToBytes(signature);
	if (!signatureBytes || signatureBytes.length !== 64) return false;
	const key = await importPublicKey(publicKey);
	return crypto.subtle.verify(
		{ name: "Ed25519" },
		key,
		signatureBytes,
		new TextEncoder().encode(timestamp + body),
	);
}

// ----------------------------------------------------------------- transport

// Discord's error codes for an interaction token that's gone.
const UNKNOWN_INTERACTION = 10062;
const UNKNOWN_WEBHOOK = 10015;
const INVALID_WEBHOOK_TOKEN = 50027;

async function discordError(response: Response, what: string): Promise<Error> {
	const text = await response.text().catch(() => "");
	let code: number | undefined;
	try {
		code = (JSON.parse(text) as { code?: number }).code;
	} catch {}
	if (
		code === INVALID_WEBHOOK_TOKEN ||
		code === UNKNOWN_WEBHOOK ||
		code === UNKNOWN_INTERACTION
	) {
		return new NubisError(
			`${what} failed: the interaction token has expired. Discord allows follow-ups and edits for 15 minutes after an interaction.`,
		);
	}
	return new NubisError(
		`${what} failed: Discord answered ${response.status}${text ? ` ${text.slice(0, 200)}` : ""}.`,
	);
}

interface WebhookTransportOptions {
	readonly interaction: APIInteraction;
	/**
	 * Sends the initial response: as the HTTP reply when it's still open,
	 * otherwise through the callback endpoint.
	 */
	readonly respond: (response: APIInteractionResponse) => Promise<void>;
	readonly api: string;
	readonly fetch: typeof fetch;
}

/**
 * Answers the first response in the HTTP reply and everything after it
 * through the interaction's webhook. Neither needs the bot token.
 */
/** A JSON body, or multipart with `payload_json` and `files[n]` when there are files. */
function requestBody(
	body: unknown,
	files: readonly ReplyFile[] | undefined,
): { body?: string | FormData; headers: Record<string, string> } {
	if (body === undefined) return { headers: {} };
	if (!files?.length) {
		return {
			body: JSON.stringify(body),
			headers: { "content-type": "application/json" },
		};
	}
	const form = new FormData();
	form.append("payload_json", JSON.stringify(body));
	files.forEach((file, index) => {
		const blob =
			file.data instanceof Blob
				? file.data
				: new Blob([file.data as Uint8Array], {
						type: file.contentType ?? "application/octet-stream",
					});
		form.append(`files[${index}]`, blob, file.name);
	});
	// fetch sets the multipart boundary itself.
	return { body: form, headers: {} };
}

function webhookTransport(options: WebhookTransportOptions): Transport {
	const { interaction, api } = options;
	const webhook = `${api}/webhooks/${interaction.application_id}/${interaction.token}`;
	const call = async (
		method: string,
		url: string,
		what: string,
		body?: unknown,
		files?: readonly ReplyFile[],
	) => {
		const request = requestBody(body, files);
		const response = await options.fetch(url, { method, ...request });
		if (!response.ok) throw await discordError(response, what);
	};
	const editOriginal = (
		body: APIInteractionResponseCallbackData,
		files?: readonly ReplyFile[],
	) =>
		call(
			"PATCH",
			`${webhook}/messages/@original`,
			"Editing the reply",
			body,
			files,
		);

	return {
		respond: async (response, files) => {
			if (files?.length && "data" in response) {
				// Files can't ride in a JSON HTTP response: acknowledge first,
				// then put the message (files and all) in place with an edit.
				const updating =
					response.type === InteractionResponseType.UpdateMessage;
				const flags = (response.data as { flags?: number } | undefined)?.flags;
				await options.respond(
					updating
						? { type: InteractionResponseType.DeferredMessageUpdate }
						: {
								type: InteractionResponseType.DeferredChannelMessageWithSource,
								data: flags ? { flags } : {},
							},
				);
				await editOriginal(
					response.data as APIInteractionResponseCallbackData,
					files,
				);
				return;
			}
			await options.respond(response);
		},
		editOriginal,
		deleteOriginal: () =>
			call("DELETE", `${webhook}/messages/@original`, "Deleting the reply"),
		followUp: (body, files) =>
			call("POST", webhook, "Sending a follow-up", body, files),
	};
}

const json = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});

/**
 * An HTTP endpoint for Discord's "Interactions Endpoint URL". Takes a web
 * standard Request and returns a Response, so it runs on Node, Bun, Deno and
 * serverless platforms alike:
 *
 *     const handle = createInteractionHandler({ publicKey, project });
 *     export default { fetch: handle };
 */
export function createInteractionHandler(
	options: InteractionHandlerOptions,
): (request: Request) => Promise<Response> {
	const api = options.api ?? DEFAULT_API;
	const fetcher = options.fetch ?? fetch;
	// Fail on a bad key now, not on the first request.
	void importPublicKey(options.publicKey);

	return async (request) => {
		if (request.method !== "POST") return new Response(null, { status: 405 });

		const signature = request.headers.get("x-signature-ed25519");
		const timestamp = request.headers.get("x-signature-timestamp");
		const body = await request.text();
		if (
			!signature ||
			!timestamp ||
			!(await verifyDiscordRequest(
				options.publicKey,
				signature,
				timestamp,
				body,
			))
		) {
			return new Response("Bad request signature", { status: 401 });
		}

		const interaction = JSON.parse(body) as APIInteraction;
		if (interaction.type === InteractionType.Ping) {
			return json({ type: InteractionResponseType.Pong });
		}

		let answered = false;
		let answer: (response: APIInteractionResponse) => void = () => {};
		const initial = new Promise<APIInteractionResponse>((resolve) => {
			answer = resolve;
		});
		const transport = webhookTransport({
			interaction,
			api,
			fetch: fetcher,
			respond: async (response) => {
				if (!answered) {
					answered = true;
					answer(response);
					return;
				}
				// The HTTP request was already answered: use the callback endpoint.
				const callback = await fetcher(
					`${api}/interactions/${interaction.id}/${interaction.token}/callback`,
					{
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify(response),
					},
				);
				if (!callback.ok) throw await discordError(callback, "Responding");
			},
		});

		const work = routeInteraction(
			options.project,
			interaction,
			transport,
			options.dispatch ?? {},
		)
			.catch((error: unknown) => ({ status: "error", error }))
			.then((result) => {
				options.onResult?.({ interaction, ...result });
				return result;
			});
		options.waitUntil?.(work);

		// The HTTP reply is whichever comes first: the initial response, or the
		// handler finishing without one.
		const first = await Promise.race([initial, work.then(() => undefined)]);
		if (first === undefined) {
			answered = true;
			return json({ error: "The handler finished without responding." }, 500);
		}
		return json(first);
	};
}
