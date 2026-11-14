# @nubisjs/testing

## 0.1.0

### Minor Changes

- c3a5084: First release: file-based commands with types inferred from their definitions, typed components and modals, guards and middleware, context menus, typed gateway events, autocomplete, the reply lifecycle with file uploads, a typed `api` in every handler, the gateway bot and the `nubis dev`, `start` and `sync` CLI, `nubis.config.ts`, an HTTP interactions endpoint, and testing without Discord.
- 4f17f74: Localizations: commands, folders and options take `nameLocalizations` and `descriptionLocalizations`, choices and context menus take `nameLocalizations`, each checked against Discord's rules per language. `nubis sync` reads Discord's commands with their translations, so a changed translation is synced. In `nubis/testing`, `.as({ locale, guildLocale })` sets the user's and the server's language.

### Patch Changes

- 4f16db3: Three fixes found while building a production bot on Nubis:
  
  - **Modal fields can be reworded per showing.** `modal(...)({ fields: { email: { label, description, placeholder } } })` changes a field's words for that render, so one modal can be shown in each user's language instead of defining one per language. Reworded text is held to Discord's limits like the definition.
  - **`editReply()` after `deferUpdate()` edits the component's message**, as Discord does, instead of throwing. This also covers a slow click that Nubis auto-deferred: a handler that finishes with `editReply()` no longer fails after two seconds.
  - **`testCommand(...).run()` takes no argument when every option is optional**, not only when the command has no options.
- Updated dependencies [4f16db3]
- Updated dependencies [c3a5084]
- Updated dependencies [4f17f74]
- Updated dependencies [404b294]
  - @nubisjs/core@0.1.0

## 0.1.0-next.4

### Patch Changes

- 4f16db3: Three fixes found while building a production bot on Nubis:
  
  - **Modal fields can be reworded per showing.** `modal(...)({ fields: { email: { label, description, placeholder } } })` changes a field's words for that render, so one modal can be shown in each user's language instead of defining one per language. Reworded text is held to Discord's limits like the definition.
  - **`editReply()` after `deferUpdate()` edits the component's message**, as Discord does, instead of throwing. This also covers a slow click that Nubis auto-deferred: a handler that finishes with `editReply()` no longer fails after two seconds.
  - **`testCommand(...).run()` takes no argument when every option is optional**, not only when the command has no options.
- Updated dependencies [4f16db3]
  - @nubisjs/core@0.1.0-next.4

## 0.1.0-next.3

### Patch Changes

- Updated dependencies [404b294]
  - @nubisjs/core@0.1.0-next.3

## 0.1.0-next.2

### Patch Changes

- @nubisjs/core@0.1.0-next.2

## 0.1.0-next.1

### Minor Changes

- 4f17f74: Localizations: commands, folders and options take `nameLocalizations` and `descriptionLocalizations`, choices and context menus take `nameLocalizations`, each checked against Discord's rules per language. `nubis sync` reads Discord's commands with their translations, so a changed translation is synced. In `nubis/testing`, `.as({ locale, guildLocale })` sets the user's and the server's language.

### Patch Changes

- Updated dependencies [4f17f74]
  - @nubisjs/core@0.1.0-next.1

## 0.1.0-next.0

### Minor Changes

- 162a5a7: First release: file-based commands with types inferred from their definitions, typed components and modals, guards and middleware, context menus, typed gateway events, autocomplete, the reply lifecycle with file uploads, a typed `api` in every handler, the gateway bot and the `nubis dev`, `start` and `sync` CLI, `nubis.config.ts`, an HTTP interactions endpoint, and testing without Discord.

### Patch Changes

- Updated dependencies [162a5a7]
  - @nubisjs/core@0.1.0-next.0
