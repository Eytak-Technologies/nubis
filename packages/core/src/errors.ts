/** Thrown for mistakes in a bot's own definitions, with the file or command it came from. */
export class NubisError extends Error {
	override readonly name = "NubisError";
}

/** Where a handler error happened, for logging and error trackers. */
export interface ErrorInfo {
	readonly kind:
		"command" | "menu" | "component" | "modal" | "autocomplete" | "event";
	/** "/config set", a component id, a menu name, or an event name. */
	readonly name: string;
	/** The interaction, for everything but events. */
	readonly interaction?: unknown;
}

/**
 * Receives every error a handler throws, after the user has been told
 * something went wrong. A good place for logging or Sentry.
 */
export type ErrorHandler = (error: unknown, info: ErrorInfo) => void;

/** Calls the error handler without letting it break the dispatch. */
export function reportError(
	onError: ErrorHandler | undefined,
	error: unknown,
	info: ErrorInfo,
): void {
	if (!onError) return;
	try {
		onError(error, info);
	} catch {
		// An error handler that throws has nowhere better to report to.
	}
}
