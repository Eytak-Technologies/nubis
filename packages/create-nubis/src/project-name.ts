const VALID_NAME = /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;

export function resolveProjectName(args: readonly string[]): string {
	const name = args.find((arg) => !arg.startsWith("-")) ?? "my-bot";
	if (!VALID_NAME.test(name)) {
		throw new Error(
			`"${name}" is not a valid package name. Use lowercase letters, digits and dashes.`,
		);
	}
	return name;
}
