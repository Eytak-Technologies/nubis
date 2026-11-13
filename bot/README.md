# bot

A Discord bot built with [Nubis](https://eytak.com/nubis). Docs: https://eytak.com/nubis/docs

## Getting started

1. Create an application at https://discord.com/developers/applications and add a bot.
2. Copy `.env.example` to `.env` and fill it in.
3. Run the tests: `npm run test`
4. Start the bot: `npm run dev`

Needs Node 22.18 or later, which runs TypeScript files directly.

Import your own files with their extension (`../components/counter.ts`): Node needs it, and Bun accepts it.

## Deploying

`npm run sync` registers your commands everywhere the bot is installed; run it when commands change. `npm run start` runs the bot.

## Layout

| Path | What it is |
| --- | --- |
| `commands/ping.ts` | `/ping`, the smallest command |
| `commands/echo.ts` | `/echo`, with a required option |
| `commands/fun/roll.ts` | `/fun roll`: folders become subcommands; `_folder.ts` describes them |
| `commands/counter.ts`, `components/counter.ts` | A button that keeps its count in typed state |
| `events/ready.ts` | Runs when the bot connects |
| `nubis.config.ts` | Bot-wide settings: presence, intents, guards, error handling |
| `tests/` | Tests that run without Discord, using `nubis/testing` |
