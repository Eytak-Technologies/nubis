# nubis

## 0.1.0-next.4

### Patch Changes

- Updated dependencies [4f16db3]
  - @nubisjs/core@0.1.0-next.4
  - @nubisjs/testing@0.1.0-next.4

## 0.1.0-next.3

### Patch Changes

- Updated dependencies [404b294]
  - @nubisjs/core@0.1.0-next.3
  - @nubisjs/testing@0.1.0-next.3

## 0.1.0-next.2

### Patch Changes

- 662bc82: New bots load on Node: the template's imports between its own files name the `.ts` file, its tsconfig allows that, and a Node project requires Node 22.18+, which runs TypeScript directly. A Bun project runs the CLI under Bun (`bun --bun nubis dev`). When a `.ts` import without its extension fails on Node, the loader says which file and how to fix it.
- @nubisjs/core@0.1.0-next.2
  - @nubisjs/testing@0.1.0-next.2

## 0.1.0-next.1

### Minor Changes

- 4f17f74: Localizations: commands, folders and options take `nameLocalizations` and `descriptionLocalizations`, choices and context menus take `nameLocalizations`, each checked against Discord's rules per language. `nubis sync` reads Discord's commands with their translations, so a changed translation is synced. In `nubis/testing`, `.as({ locale, guildLocale })` sets the user's and the server's language.

### Patch Changes

- Updated dependencies [4f17f74]
  - @nubisjs/core@0.1.0-next.1
  - @nubisjs/testing@0.1.0-next.1

## 0.1.0-next.0

### Minor Changes

- 162a5a7: First release: file-based commands with types inferred from their definitions, typed components and modals, guards and middleware, context menus, typed gateway events, autocomplete, the reply lifecycle with file uploads, a typed `api` in every handler, the gateway bot and the `nubis dev`, `start` and `sync` CLI, `nubis.config.ts`, an HTTP interactions endpoint, and testing without Discord.

### Patch Changes

- Updated dependencies [162a5a7]
  - @nubisjs/core@0.1.0-next.0
  - @nubisjs/testing@0.1.0-next.0
