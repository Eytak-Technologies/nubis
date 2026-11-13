export type PackageManager = "bun" | "npm" | "pnpm" | "yarn";

export interface TemplateOptions {
	readonly name: string;
	readonly packageManager: PackageManager;
	/** The `nubis` version range to depend on. */
	readonly nubisVersion: string;
}

const json = (value: unknown) => `${JSON.stringify(value, null, "\t")}\n`;

/** The files of a new bot, by path. Bun projects test with bun:test, others with Vitest. */
export function templateFiles(
	options: TemplateOptions,
): Record<string, string> {
	const { name, packageManager, nubisVersion } = options;
	const bun = packageManager === "bun";
	const run = packageManager === "npm" ? "npm run" : packageManager;
	const testImport = bun ? "bun:test" : "vitest";

	return {
		"package.json": json({
			name,
			private: true,
			type: "module",
			scripts: {
				dev: "nubis dev",
				build: "nubis build",
				test: bun ? "bun test" : "vitest run",
				typecheck: "tsc --noEmit",
			},
			dependencies: { nubis: nubisVersion },
			devDependencies: bun
				? { "@types/bun": "^1.4.4", typescript: "^7.0.0" }
				: { "@types/node": "^22.0.0", typescript: "^7.0.0", vitest: "^5.1.0" },
		}),

		"tsconfig.json": json({
			compilerOptions: {
				target: "ES2022",
				module: "Preserve",
				moduleResolution: "bundler",
				types: [bun ? "bun" : "node"],
				strict: true,
				noEmit: true,
				skipLibCheck: true,
				verbatimModuleSyntax: true,
				noUncheckedIndexedAccess: true,
			},
			include: ["**/*.ts"],
		}),

		".gitignore": "node_modules\ndist\n.env\n",

		".env.example": `# From https://discord.com/developers/applications, under your app.
DISCORD_TOKEN=
DISCORD_APPLICATION_ID=
DISCORD_PUBLIC_KEY=
`,

		"README.md": `# ${name}

A Discord bot built with [Nubis](https://github.com/Eytak-Technologies/nubis).

## Getting started

1. Create an application at https://discord.com/developers/applications and add a bot.
2. Copy \`.env.example\` to \`.env\` and fill it in.
3. Run the tests: \`${run} test\`
4. Start the bot: \`${run} dev\`

## Layout

| Path | What it is |
| --- | --- |
| \`commands/ping.ts\` | \`/ping\`, the smallest command |
| \`commands/echo.ts\` | \`/echo\`, with a required option |
| \`commands/fun/roll.ts\` | \`/fun roll\`: folders become subcommands; \`_folder.ts\` describes them |
| \`commands/counter.ts\`, \`components/counter.ts\` | A button that keeps its count in typed state |
| \`events/ready.ts\` | Runs when the bot connects |
| \`tests/\` | Tests that run without Discord, using \`nubis/testing\` |
`,

		"commands/ping.ts": `import { command } from "nubis";

export default command({
	description: "Check that the bot is alive",
	run: ({ reply }) => reply("Pong!"),
});
`,

		"commands/echo.ts": `import { command, option } from "nubis";

export default command({
	description: "Repeat something back to you",
	ephemeral: true,
	options: {
		text: option.string({ description: "What to repeat", required: true, maxLength: 200 }),
	},
	// options.text is a string: required options are never undefined.
	run: ({ options, reply }) => reply(options.text),
});
`,

		"commands/fun/_folder.ts": `import { folder } from "nubis";

export default folder({ description: "Games and silly things" });
`,

		"commands/fun/roll.ts": `import { command, option } from "nubis";

export default command({
	description: "Roll a die",
	options: {
		sides: option.integer({
			description: "How many sides",
			choices: [
				{ name: "Six", value: 6 },
				{ name: "Twenty", value: 20 },
			],
		}),
	},
	// options.sides is 6 | 20 | undefined, from the choices.
	run: ({ options, reply }) => {
		const sides = options.sides ?? 6;
		return reply(\`🎲 You rolled \${1 + Math.floor(Math.random() * sides)} (d\${sides})\`);
	},
});
`,

		"commands/counter.ts": `import { command } from "nubis";
import { counter } from "../components/counter";

export default command({
	description: "A button that counts clicks",
	run: ({ reply }) => reply({ content: "Clicked 0 times", components: [counter({ count: 0 })] }),
});
`,

		"components/counter.ts": `import { button, stateOf } from "nubis";

// The count travels in the button's custom_id, so no database is needed.
// For state you act on (user ids, amounts), use a schema such as Zod instead
// of stateOf: anyone can craft a custom_id, and schemas validate every click.
export const counter = button({
	id: "counter",
	label: "Click me",
	style: "primary",
	state: stateOf<{ count: number }>(),
	onClick: ({ state, update }) => {
		const count = state.count + 1;
		return update({ content: \`Clicked \${count} times\`, components: [counter({ count })] });
	},
});
`,

		"events/ready.ts": `import { event } from "nubis";

export default event("ready", (data) => {
	console.log(\`Logged in as \${data.user.username}\`);
});
`,

		"tests/commands.test.ts": `import { describe, expect, test } from "${testImport}";
import { fake, testCommand, testComponent } from "nubis/testing";
import { counter } from "../components/counter";
import echo from "../commands/echo";
import ping from "../commands/ping";

describe("commands", () => {
	test("/ping answers", async () => {
		const result = await testCommand(ping).run();
		expect(result.replies).toEqual(["Pong!"]);
	});

	test("/echo repeats privately", async () => {
		const result = await testCommand(echo).as({ user: fake.user("alice") }).run({ text: "hello" });
		expect(result.replies).toEqual(["hello"]);
		expect(result.ephemeral).toBe(true);
	});

	test("the counter counts", async () => {
		const result = await testComponent(counter).click({ count: 41 });
		expect(result.replies).toEqual(["Clicked 42 times"]);
	});
});
`,
	};
}
