---
"@nubisjs/core": patch
---

`nubis sync` no longer rewrites unchanged commands on apps that can be installed to users. Discord reports `integration_types: [0, 1]` for commands that don't set it on such apps, which sync took for a change on every run; a command without `integrationTypes` now matches either app default, and one that sets it is compared as written.
