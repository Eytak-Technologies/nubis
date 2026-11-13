# Security

Please report vulnerabilities privately, not in a public issue.

Use GitHub's **"Report a vulnerability"** button on this repository's Security tab. It opens a private advisory that only maintainers can see.

Include what an attacker could do, how to reproduce it, and the versions affected. You'll get an answer within a few days, and credit in the advisory if you'd like it.

Areas where reports are especially valuable:

- Interaction signature verification (`createInteractionHandler`, `verifyDiscordRequest`)
- Component and modal state: anything that lets a crafted `custom_id` reach a handler without passing its schema or guards
- Guards: ways around `hasPermission`, `invokerOnly` and the others
- Anything that makes a bot ping `@everyone`, `@here` or roles without opting in

Only the latest release gets security fixes before 1.0.
