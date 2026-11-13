# create-nubis

## 0.1.0-next.4

No changes in this release.

## 0.1.0-next.3

No changes in this release.

## 0.1.0-next.2

### Patch Changes

- 662bc82: New bots load on Node: the template's imports between its own files name the `.ts` file, its tsconfig allows that, and a Node project requires Node 22.18+, which runs TypeScript directly. A Bun project runs the CLI under Bun (`bun --bun nubis dev`). When a `.ts` import without its extension fails on Node, the loader says which file and how to fix it.

## 0.1.0-next.1

No changes in this release.

## 0.1.0-next.0

### Minor Changes

- 162a5a7: First release: file-based commands with types inferred from their definitions, typed components and modals, guards and middleware, context menus, typed gateway events, autocomplete, the reply lifecycle with file uploads, a typed `api` in every handler, the gateway bot and the `nubis dev`, `start` and `sync` CLI, `nubis.config.ts`, an HTTP interactions endpoint, and testing without Discord.
