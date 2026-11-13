import type { GuardContext } from "./guard";

export interface MiddlewareContext extends Omit<GuardContext, "deny"> {
	/** "/config set" for commands, the component or modal id otherwise. */
	readonly name: string;
	readonly kind: "command" | "component" | "modal";
}

/**
 * Wraps handlers: code before `await next()` runs first, code after it once
 * the handler has finished. Errors from the handler pass through `next()`.
 */
export type Middleware = (
	context: MiddlewareContext,
	next: () => Promise<void>,
) => Promise<void>;

/** Defines a middleware. An identity function, for types and readability. */
export function middleware(run: Middleware): Middleware {
	return run;
}

/** Runs `handler` inside every middleware, the first one outermost. */
export function runWithMiddleware(
	stack: readonly Middleware[],
	context: MiddlewareContext,
	handler: () => Promise<void>,
): Promise<void> {
	const call = (index: number): Promise<void> => {
		const current = stack[index];
		if (!current) return handler();
		let called = false;
		return current(context, () => {
			if (called) throw new Error("A middleware called next() twice.");
			called = true;
			return call(index + 1);
		});
	};
	return call(0);
}
