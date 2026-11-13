# Nubis

The Discord bot framework that feels like building a modern web app: file-based commands, types inferred from your definitions, typed components, built-in testing and one-command deploys.

> Under active development. Not ready for use yet.

## Packages

| Package | Description |
| --- | --- |
| [`nubis`](packages/nubis) | The framework and the `nubis` CLI |
| [`create-nubis`](packages/create-nubis) | Project scaffolder (`npx create-nubis`) |
| [`@nubisjs/core`](packages/core) | Commands, components, modals, guards, dispatch |
| [`@nubisjs/testing`](packages/testing) | Test bots without Discord (also `nubis/testing`) |

## Development

Requires [Bun](https://bun.sh) 1.4.4+. Published packages run on Node 20+ and Bun.

```sh
bun install
bun run build
bun run test
bun run ci:verify   # everything CI runs, including the Node smoke test
```

## License

MIT. Built by [Eytak](https://eytak.com).
