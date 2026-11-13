/** Thrown for mistakes in a bot's own definitions, with the file or command it came from. */
export class NubisError extends Error {
	override readonly name = "NubisError";
}
