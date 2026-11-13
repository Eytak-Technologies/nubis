import {
	type CommandTree,
	type ComponentDispatchOptions,
	type ComponentRegistry,
	type DispatchOptions,
	dispatch,
	dispatchAutocomplete,
	dispatchComponent,
	dispatchMenu,
	dispatchModal,
	type MenuDefinition,
	NubisError,
	type Transport,
} from "@nubisjs/core";
import {
	type APIInteraction,
	type APIInteractionResponse,
	type APIInteractionResponseCallbackData,
	ApplicationCommandType,
	InteractionResponseType,
	InteractionType,
} from "discord-api-types/v10";

/** The parts of a project that answer interactions. A loaded Project fits. */
export interface InteractionProject {
	readonly tree: CommandTree;
	readonly components: ComponentRegistry;
	readonly menus: readonly MenuDefinition[];
}

export interface InteractionHandlerOptions {
	/** The application's public key from the Developer Portal (hex). */
	readonly publicKey: string;
	readonly project: InteractionProject;
	/** Guards, middleware and auto-defer settings for every interaction. */
	readonly dispatch?: DispatchOptions & ComponentDispatchOptions;
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
	/** Answers the HTTP request with the initial response. */
	readonly respondInitial: (response: APIInteractionResponse) => boolean;
	readonly api: string;
	readonly fetch: typeof fetch;
}

/**
 * Answers the first response in the HTTP reply and everything after it
 * through the interaction's webhook. Neither needs the bot token.
 */
function webhookTransport(options: WebhookTransportOptions): Transport {
	const { interaction, api } = options;
	const webhook = `${api}/webhooks/${interaction.application_id}/${interaction.token}`;
	const call = async (
		method: string,
		url: string,
		what: string,
		body?: unknown,
	) => {
		const response = await options.fetch(url, {
			method,
			headers: body ? { "content-type": "application/json" } : {},
			body: body ? JSON.stringify(body) : undefined,
		});
		if (!response.ok) throw await discordError(response, what);
	};

	return {
		respond: async (response) => {
			if (options.respondInitial(response)) return;
			// The HTTP request was already answered: use the callback endpoint.
			await call(
				"POST",
				`${api}/interactions/${interaction.id}/${interaction.token}/callback`,
				"Responding",
				response,
			);
		},
		editOriginal: (body: APIInteractionResponseCallbackData) =>
			call("PATCH", `${webhook}/messages/@original`, "Editing the reply", body),
		deleteOriginal: () =>
			call("DELETE", `${webhook}/messages/@original`, "Deleting the reply"),
		followUp: (body: APIInteractionResponseCallbackData) =>
			call("POST", webhook, "Sending a follow-up", body),
	};
}

// ------------------------------------------------------------------- routing

function route(
	project: InteractionProject,
	interaction: APIInteraction,
	transport: Transport,
	options: DispatchOptions & ComponentDispatchOptions,
): Promise<{ readonly status: string; readonly error?: unknown }> {
	switch (interaction.type) {
		case InteractionType.ApplicationCommand:
			return interaction.data.type === ApplicationCommandType.ChatInput
				? dispatch(project.tree, interaction as never, transport, options)
				: dispatchMenu(project.menus, interaction as never, transport, options);
		case InteractionType.MessageComponent:
			return dispatchComponent(
				project.components,
				interaction,
				transport,
				options,
			);
		case InteractionType.ApplicationCommandAutocomplete:
			return dispatchAutocomplete(
				project.tree,
				interaction,
				transport,
				options,
			);
		case InteractionType.ModalSubmit:
			return dispatchModal(project.components, interaction, transport, options);
		default:
			return Promise.resolve({ status: "unsupported" });
	}
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
			respondInitial: (response) => {
				if (answered) return false;
				answered = true;
				answer(response);
				return true;
			},
		});

		const work = route(
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
