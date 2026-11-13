# nubis

The Discord bot framework that feels like building a modern web app: file-based commands, types inferred from your definitions, typed components and modals, guards, and testing without Discord.

```ts
import { command, option } from "nubis";

export default command({
	description: "Say hi",
	options: { who: option.user({ required: true }) },
	run: ({ options, reply }) => reply(`Hi ${options.who.username}!`),
});
```

- `nubis`: commands, components, modals, guards, and the HTTP interactions handler
- `nubis/node`: load a bot from its folders, serve it with `node:http`
- `nubis/testing`: run commands and components as Discord would, in tests

Docs and examples: https://github.com/Eytak-Technologies/nubis

MIT. Built by [Eytak](https://eytak.com).
