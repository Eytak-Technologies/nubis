---
"@nubisjs/core": patch
"@nubisjs/testing": patch
---

Three fixes found while building a production bot on Nubis:

- **Modal fields can be reworded per showing.** `modal(...)({ fields: { email: { label, description, placeholder } } })` changes a field's words for that render, so one modal can be shown in each user's language instead of defining one per language. Reworded text is held to Discord's limits like the definition.
- **`editReply()` after `deferUpdate()` edits the component's message**, as Discord does, instead of throwing. This also covers a slow click that Nubis auto-deferred: a handler that finishes with `editReply()` no longer fails after two seconds.
- **`testCommand(...).run()` takes no argument when every option is optional**, not only when the command has no options.
