# @nubisjs/core

## 0.1.0-next.1

### Minor Changes

- 4f17f74: Localizations: commands, folders and options take `nameLocalizations` and `descriptionLocalizations`, choices and context menus take `nameLocalizations`, each checked against Discord's rules per language. `nubis sync` reads Discord's commands with their translations, so a changed translation is synced. In `nubis/testing`, `.as({ locale, guildLocale })` sets the user's and the server's language.

## 0.1.0-next.0

### Minor Changes

- 162a5a7: First release: file-based commands with types inferred from their definitions, typed components and modals, guards and middleware, context menus, typed gateway events, autocomplete, the reply lifecycle with file uploads, a typed `api` in every handler, the gateway bot and the `nubis dev`, `start` and `sync` CLI, `nubis.config.ts`, an HTTP interactions endpoint, and testing without Discord.
