# CLAUDE.md

Read `HANDOFF.md` first: it has the context, site facts, constraints and the next job
(a frame test kit for Barco Event Master push updates, then implementation).

- Run tests: `npm test` (mock frame on 127.0.0.1:9999; needs that port free)
- Format/lint: `npm run format`, `npm run lint`
- Package: `npx companion-module-build`
- Keep module code Node 18 compatible (Companion's bundled runtime)
- Do not add periodic polling of the frame by default
