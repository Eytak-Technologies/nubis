---
"create-nubis": patch
"nubis": patch
---

New bots load on Node: the template's imports between its own files name the `.ts` file, its tsconfig allows that, and a Node project requires Node 22.18+, which runs TypeScript directly. A Bun project runs the CLI under Bun (`bun --bun nubis dev`). When a `.ts` import without its extension fails on Node, the loader says which file and how to fix it.
