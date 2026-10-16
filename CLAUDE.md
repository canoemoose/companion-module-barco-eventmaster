# CLAUDE.md

**Current job: read `docs/upstream-prs-scope.md` first.** It is the source of truth: the rules for the
upstream PRs (minimal, standalone, no tests, no version bumps, every upstream claim proven on real
hardware by observed frame behaviour), the PR split, the claims to prove, and the hardware session plan.

Background, in order of usefulness: `docs/frame-test-2026-10-15-findings.md` (what the E2 actually does
on 9.2.6318), then `HANDOFF.md` (the original brief and history; its "next job" is done).

**No hardware.** The 2026-10-16 session (E2 9.2.6373, PDS-4K 9.2.5963) is over and the frames have gone.
Everything proven is in the scope doc. Don't plan work that needs a frame: mock runs check scripts and
code, they are not evidence. The four PR branches are cut and checked, in worktrees beside the repo
(scope doc, "PRs").

- Fork build numbering: `4.4.6-ee.N` (upstream is 4.4.5). Fork-only, never in a PR
- Package manager: **npm** (not yarn). Don't commit changes npm makes to upstream's `yarn.lock`
- Run tests: `npm test` (mock frame on 127.0.0.1:9999; needs that port free)
- Format/lint: `npm run format`, `npm run lint`
- Package on Windows: `npm run package:win` (plain `npm run package` breaks under Volta's npm shims and
  can write a .tgz with no `main.js`; see `tools/package.js`). Either way the package is checked for
  `pkg/main.js` and the command fails if it's missing
- Run frame scripts with Companion's node18 (`C:\Program Files\Companion\resources\node-runtimes\node18\node.exe`):
  its existing firewall rule covers any port. Use a port other than 3000 when Companion is running
- Keep module code Node 18 compatible (Companion's bundled runtime)
- Do not add periodic polling of the frame by default. With live updates working, the module uses a
  one-call heartbeat every 15 s and a full refresh every 5 min instead of the full poll
- No XML (port 9876) in this module (Matt's decision)
