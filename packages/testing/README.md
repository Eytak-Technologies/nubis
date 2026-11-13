# @nubisjs/testing

Test [Nubis](https://github.com/Eytak-Technologies/nubis) bots without Discord. Also available as `nubis/testing`.

```ts
import { fake, testCommand } from "nubis/testing";

const result = await testCommand(ban)
	.as({ permissions: PermissionFlagsBits.BanMembers })
	.run({ user: fake.user("alice") });

expect(result.replies).toEqual(["Ban alice?"]);
```

`testCommand`, `testComponent` (click, select, raw custom_ids), `testModal` and `testMenu`, with fake users, roles, channels and messages.

MIT. Built by [Eytak](https://eytak.com).
