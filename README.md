# Nubis

**The Discord bot framework that feels like building a modern web app.** A file is a command, types come from your definitions, components carry typed state, and tests run without Discord.

**Docs: [eytak.com/nubis/docs](https://eytak.com/nubis/docs)**

> Nubis is in active development and not released yet. Everything below works today; the first release, 0.1.0, is on its way.

```ts
// commands/ban.ts → /ban
import { command, hasPermission, option } from "nubis";
import { PermissionFlagsBits } from "discord-api-types/v10";
import { confirmBan } from "../components/confirm-ban";

export default command({
	description: "Ban a member",
	options: {
		user: option.user({ required: true }),
		days: option.integer({ choices: [{ name: "One day", value: 1 }, { name: "A week", value: 7 }] }),
	},
	guards: [hasPermission(PermissionFlagsBits.BanMembers)],
	run: ({ options, reply }) =>
		// options.user: APIUser · options.days: 1 | 7 | undefined
		reply({
			content: `Ban ${options.user.username}?`,
			components: [confirmBan({ userId: options.user.id })],
			ephemeral: true,
		}),
});
```

```ts
// components/confirm-ban.ts
import { button, invokerOnly } from "nubis";
import { z } from "zod";

export const confirmBan = button({
	id: "confirm-ban",
	label: "Confirm",
	style: "danger",
	state: z.object({ userId: z.string() }), // validated on every click
	guards: [invokerOnly], // only whoever ran /ban can click
	onClick: ({ state, update }) => update(`Banned <@${state.userId}>.`),
});
```

```ts
// commands/ban.test.ts
import { fake, testCommand } from "nubis/testing";
import ban from "./ban";

test("asks for confirmation", async () => {
	const result = await testCommand(ban)
		.as({ permissions: PermissionFlagsBits.BanMembers })
		.run({ user: fake.user("alice") });
	expect(result.replies).toEqual(["Ban alice?"]);
	expect(result.ephemeral).toBe(true);
});
```

## What you get

- **Files are commands.** `commands/config/set.ts` is `/config set`. A folder's `_folder.ts` sets its description, guards and permissions.
- **Types from definitions.** Option values, choice unions, component state, select values and modal fields are all inferred. There are no string lookups.
- **Typed components and modals.** State lives in the `custom_id` (or in a store when it's large) and is validated with any Standard Schema library: Zod, Valibot, ArkType…
- **Discord's rules before Discord.** Name formats, length limits, 25 options and choices, 100-character custom_ids, five rows of components: Nubis throws when you define something Discord would reject, and the error names the file.
- **One `reply()`.** Nubis sends "thinking…" when a handler is slow, turns later replies into follow-ups, and answers errors, so "already replied" and "did not respond" don't happen by accident.
- **Guards and middleware** for commands, folders, components and modals: `hasPermission`, `hasRole`, `cooldown`, `invokerOnly`, or your own.
- **Context menus, autocomplete and typed gateway events.**
- **Runs anywhere.** Node 20+ and Bun. The HTTP interactions endpoint takes a web standard `Request`, so it also runs on serverless platforms.
- **Testing built in.** `nubis/testing` runs commands, buttons, selects, modals and menus as Discord would.

## Packages

| Package | Description |
| --- | --- |
| [`nubis`](packages/nubis) | The framework: everything below, plus the `nubis` CLI, `nubis/node` and `nubis/testing` |
| [`create-nubis`](packages/create-nubis) | `npx create-nubis my-bot` |
| [`@nubisjs/core`](packages/core) | Commands, components, modals, guards, dispatch |
| [`@nubisjs/testing`](packages/testing) | Test bots without Discord |

## Development

Requires [Bun](https://bun.sh) 1.4.4+.

```sh
bun install
bun run ci:verify   # lint, format, types, tests, build, and a plain-Node smoke test
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for how the repo is laid out and how releases work.

## License

MIT. Built by [Eytak](https://eytak.com).
