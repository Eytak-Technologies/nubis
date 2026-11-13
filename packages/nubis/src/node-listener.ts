import type { IncomingMessage, ServerResponse } from "node:http";

/**
 * Adapts a fetch-style handler (`Request` in, `Response` out) to a
 * `node:http` listener:
 *
 *     createServer(toNodeListener(createInteractionHandler({ ... }))).listen(3000);
 */
export function toNodeListener(
	handler: (request: Request) => Promise<Response>,
): (request: IncomingMessage, response: ServerResponse) => void {
	return (incoming, outgoing) => {
		void (async () => {
			try {
				const chunks: Buffer[] = [];
				for await (const chunk of incoming) chunks.push(chunk as Buffer);
				const headers = new Headers();
				for (const [name, value] of Object.entries(incoming.headers)) {
					if (typeof value === "string") headers.set(name, value);
					else if (Array.isArray(value)) headers.set(name, value.join(", "));
				}
				const method = incoming.method ?? "GET";
				const request = new Request(
					`http://${incoming.headers.host ?? "localhost"}${incoming.url ?? "/"}`,
					{
						method,
						headers,
						body:
							method === "GET" || method === "HEAD"
								? undefined
								: Buffer.concat(chunks),
					},
				);
				const response = await handler(request);
				outgoing.writeHead(
					response.status,
					Object.fromEntries(response.headers.entries()),
				);
				outgoing.end(Buffer.from(await response.arrayBuffer()));
			} catch (error) {
				outgoing.writeHead(500, { "content-type": "text/plain" });
				outgoing.end("Internal error");
				console.error(error);
			}
		})();
	};
}
