# CLAUDE.md

Read `HANDOFF.md` first: it has the context, findings from the first frame, constraints and the next job
(a frame test kit for Barco Event Master push updates, then implementation).
The next test is **this afternoon** on a different, **blank** warehouse frame (same v9 firmware, same
laptop, different network): the kit needs a minimal programming checklist, a readiness check, and a
network-profile check. Working and rehearsed beats polished.
Test frame: E2 at 192.168.0.175; laptop: 192.168.0.100.

- Package manager: **npm** (not yarn). Don't commit changes npm makes to upstream's `yarn.lock`
- Run tests: `npm test` (mock frame on 127.0.0.1:9999; needs that port free)
- Format/lint: `npm run format`, `npm run lint`
- Package on Windows: `npm run package:win` (plain `npm run package` breaks under Volta's npm shims and
  can write a .tgz with no `main.js`; see `tools/package.js`). Either way the package is checked for
  `pkg/main.js` and the command fails if it's missing
- Keep module code Node 18 compatible (Companion's bundled runtime)
- Do not add periodic polling of the frame by default
