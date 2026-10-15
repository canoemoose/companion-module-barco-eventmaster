# CLAUDE.md

Read `HANDOFF.md` first: it has the context, findings from the first frame, constraints and the next job
(a frame test kit for Barco Event Master push updates, then implementation).
The next test is **this afternoon** on a different, **blank** warehouse frame (same v9 firmware, same
laptop, different network): the kit needs a minimal programming checklist, a readiness check, and a
network-profile check. Working and rehearsed beats polished.

- Package manager: **npm** (not yarn). Don't commit changes npm makes to upstream's `yarn.lock`
- Run tests: `npm test` (mock frame on 127.0.0.1:9999; needs that port free)
- Format/lint: `npm run format`, `npm run lint`
- Package: `npm run package`
- Keep module code Node 18 compatible (Companion's bundled runtime)
- Do not add periodic polling of the frame by default
