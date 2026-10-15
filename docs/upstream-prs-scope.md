# Upstream PRs: scope

Source of truth for turning the fork's work into upstream PRs to `bitfocus/companion-module-barco-eventmaster`.
Upstream base: v4.4.5, commit `9f84de7`. Fork branch: `feature/freeze-toggle-feedback` (latest build
`4.5.1-ee.21`; fork builds are tagged `-ee.N` on a 4.5.1 base so they sort above the earlier `4.5.0-freeze.N` builds). Background: `HANDOFF.md`, `docs/frame-test-2026-10-15-findings.md`.

## Rules (Matt, 2026-10-15)

- **PRs are minimal and standalone.** Each one makes sense and works on its own against upstream.
- **No tests in the PRs.** Upstream has none; the fork's `test/` stays in the fork.
- **The proof is what the frame actually does, not what it replies.** Each proof shows observed
  behaviour: the output or EMT (Matt watching), an independent read-back over a separate connection,
  or a notification actually arriving at a listener. The JSON-RPC reply (`success: 0` etc.) is
  supporting evidence only: the frame accepted an aux arm with `success: 0` while no read showed it.
- **Every claim that upstream is broken must be proven on real hardware**, by running upstream's own
  code (`9f84de7`, unchanged) against a real frame. Mock runs only check a script works; they are not
  evidence. A claim that can't be reproduced on hardware doesn't go in a PR.
- Fork-only, never upstreamed: `frame-test-kit/` (incl. `module-check.js`), `tools/package.js`, `docs/`,
  `HANDOFF.md`, `CLAUDE.md`, the `-ee.N` (formerly `-freeze.N`) version tags, `package-lock.json`. Don't touch `yarn.lock`.
- No XML (9876) in this module.

## Proposed PRs

1. **Freeze control and feedback** (new feature). Source/screen/aux freeze toggle actions, frozen
   feedbacks, `*_frozen` / `*_label` variables, freeze presets, live-input-only dropdowns. Screen freeze
   reads `DestOutMapCol`/`FrzMode` with `DestOutMapColl`/`Freeze` fallback. Works with plain polling.
2. **Live updates** (fixes + rework). Listener rewrite, all notification types, targeted reads, tally
   cache, heartbeat replacing the full poll while subscribed, reboot recovery, netmask-aware auto-detect,
   detected-address hint, listener caption. Cites proven upstream bugs 2 to 4 below.
3. **Status feedback** (new feature, depends on 2). Screen armed + arm toggle, source signal (with
   "Lights when"), test pattern active. Aux arm not supported (no JSON-RPC read-back).
4. **Aux test pattern presets fix** (tiny standalone bug fix). Proven bug 1.

Split still to confirm after the hardware session.

## Upstream claims to prove on hardware

Retracted: "screen freeze feedback broken upstream". Upstream has no screen freeze feedback at all.

| #        | Claim (from reading `9f84de7`)                                                                                                                      | Code                                      | Proof on hardware                                                                                                                                    |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1        | Aux test pattern presets do nothing: presets set `screenDestination`, the `testpattern_on_AUX` action reads `auxDestination`, so it sends `id: NaN` | `presets.js` ~634, `eventmaster.js` ~1458 | Run upstream preset action against the E2 (has an aux): capture the request, frame reply, and the aux test pattern unchanged. PDS-4K has no aux: N/A |
| 2        | "Unsubscribe to start clean" is a no-op: `this.eventmaster.unsubscribe(callback)` (callback in the hostname slot, no port/types)                    | `eventmaster.js` ~248                     | Capture the request and frame reply. Then show a leftover subscription from a previous run still delivers (frame keeps notifying the old port)       |
| 3        | Live updates can't restart: teardown never stops the notification server, so setup again (config change) hits address in use                        | `eventmaster.js` ~312, listener `start()` | Upstream module: enable live updates, change config (re-init), record outcome; does a notification still arrive afterwards?                          |
| 4        | If the notification port is taken, the module process crashes (listener error unhandled)                                                            | listener / `startNotificationServer`      | Hold the port, enable live updates against a real frame, record whether the module process dies                                                      |
| 5 (open) | Upstream subscribes with a numeric port; does the frame accept it?                                                                                  | listener line 40                          | Subscribe with number vs string, check `success` and whether notifications arrive. Only claim if it fails                                            |

The behaviour each proof rests on (the reply is only supporting):

- 1: the aux output shows no test pattern (Matt watching), and an independent read-back of the aux
  shows `TestPatternMode` 0. Control: the same pattern sent with the right option does appear.
- 2: after the "clean" unsubscribe, a subscription left by a previous run still receives
  notifications (a listener on the old port gets them when Matt changes something).
- 3: after re-init, notifications no longer arrive at the module (and the error it hits).
- 4: the module process exits.
- 5: notifications arrive (or don't) with a numeric port versus a string port.

## Hardware session plan (E2 + PDS-4K on one network)

0. Frame setup is Claude's job (Matt, 2026-10-15), within what JSON-RPC allows: put each frame in a
   known state and confirm by read-back (nothing frozen or armed, test patterns off, a preset recalled).
   JSON-RPC can't create destinations, assign outputs or add sources: that's EMT. The E2 is programmed
   (2 inputs, 1 screen with 4 layer entries, 1 aux, presets). The PDS-4K is never blank: it always
   has 2 or 4 screen destinations (depending on mode) and 10 inputs, and no auxes. No programming needed.
1. Note both frames' IPs, model, firmware (`module-check.js` read-only on each).
2. Fork module on both: `module-check.js --changes` (freeze, arm, test pattern round trips). PDS-4K has
   no auxes; check whether it has `powerStatus`, which shapes it uses, which notifications fire.
3. Upstream proofs: a harness that loads upstream `9f84de7` (git worktree, shared `node_modules`) and
   drives it against each frame per the table above. Save transcripts under
   `frame-test-kit/results/upstream-proof-*` as evidence.
4. Decide the PR split from the results, then cut branches from upstream master.

## Status

- [x] Fork feature work done and verified on the E2 (freeze, tally, arm, signal, test pattern,
      heartbeat, reboot recovery)
- [x] `module-check.js` ready (rehearsed on mocks only)
- [ ] Upstream proof harness written (rehearse on mock for correctness only)
- [ ] Hardware session: module-check on both frames; upstream proofs 1 to 5
- [ ] PR split confirmed; branches cut; PR text drafted (Matt pushes/opens)
