import { NubisError } from "./errors";

// Discord's rule for chat input command and option names, lowercase only.
// https://discord.com/developers/docs/interactions/application-commands#application-command-object-application-command-naming
const NAME = /^[-_'\p{L}\p{N}\p{sc=Deva}\p{sc=Thai}]{1,32}$/u;

export function assertValidName(name: string, where: string): void {
	if (!NAME.test(name) || name !== name.toLowerCase()) {
		throw new NubisError(
			`${where}: "${name}" is not a valid Discord command or option name. Use 1-32 lowercase letters, digits, "-" or "_".`,
		);
	}
}

export function assertValidDescription(
	description: string,
	where: string,
): void {
	if (description.length < 1 || description.length > 100) {
		throw new NubisError(
			`${where}: descriptions must be 1-100 characters (got ${description.length}).`,
		);
	}
}
