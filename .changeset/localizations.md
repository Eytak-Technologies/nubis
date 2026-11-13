---
"@nubisjs/core": minor
"@nubisjs/testing": minor
"nubis": minor
---

Localizations: commands, folders and options take `nameLocalizations` and `descriptionLocalizations`, choices and context menus take `nameLocalizations`, each checked against Discord's rules per language. `nubis sync` reads Discord's commands with their translations, so a changed translation is synced. In `nubis/testing`, `.as({ locale, guildLocale })` sets the user's and the server's language.
