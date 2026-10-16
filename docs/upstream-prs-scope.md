# Upstream PRs: scope

Source of truth for turning the fork's work into upstream PRs to `bitfocus/companion-module-barco-eventmaster`.
Upstream base: v4.4.5, commit `9f84de7`. Fork branch: `feature/freeze-toggle-feedback` (latest build
`4.4.6-ee.21`; fork builds are `<upstream next patch>-ee.N`, so they sort above upstream 4.4.5 and below its next release. Older `4.5.0-freeze.N` builds sort higher: remove them from Companion). Background: `HANDOFF.md`, `docs/frame-test-2026-10-15-findings.md`.

Barco's current protocol reference: **R5919184/02 (2026-01-27)**, "Remote control protocol, Event Master
series", https://www.barco.com/manuals/R5919184/index.html, with separate 9.x and 10.x command chapters,
per-command **Availability** by model, and `FrameType` codes (0 E2, 1 S3, 2 Ex, 3 IP-4K, 5 E2 Gen2,
6 PDS-4K, 8 Encore3). Newer than the two docs in `docs/`. Copyright Barco: link it, don't copy it in.
Points that bear on the PRs and proofs:

- PDS-4K: `listContent`, `changeContent`, `freezeDestSource`, `armUnarmDestination`, `listSources`,
  `listDestinations`, `powerStatus`, `subscribe` are available; the aux calls are not.
- It still documents screen freeze as `DestOutMapColl` / `Freeze` (no `FrzMode`); the E2 on 9.2.6318
  returns `DestOutMapCol` / `FrzMode`. Hardware wins; read both.
- Its subscribe/unsubscribe example sends the port as a string (`"3000"`): supporting evidence for
  claim 5 only, still to be proven on hardware.
- It states all subscriptions are lost when the processor restarts.

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
- **PRs change no version numbers.** In this repo only the maintainer bumps versions, in separate
  release commits; the one outside contributor PR (#123) changed none (checked 2026-10-15).
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

## Freeze: what the output actually does (2026-10-16)

Three freezes in Event Master (Matt):

- **Input**: freezes the source everywhere it is used. Green on the layer in Toolset.
- **Layer**: freezes that layer only; the same source in another layer stays live. Can be frozen on
  preview then transitioned, or directly on program. Blue in Toolset. The PDS-4K front-panel freeze
  button is this one.
- **Output**: the destination's outputs stay frozen whatever happens to the destination (transitions
  etc.). Banner in Toolset.

**Module-check's freeze "OK" only proves the read-back and the notification, not the picture.** Every
E2 freeze result so far was watched in Toolset only, never on a monitor. PDS-4K 9.2.5963, PGM1 on a
monitor, moving test card on HDMIInput1 in LayerA on program:

| Freeze | JSON-RPC                                               | Read-back                  | Toolset         | Output                                        |
| ------ | ------------------------------------------------------ | -------------------------- | --------------- | --------------------------------------------- |
| Input  | `freezeDestSource` type 0                              | source `Freeze` 1          | green on layer  | not frozen                                    |
| Layer  | `changeContent {id, Layers: [{id, Freeze: 1}]}`        | layer `Freeze` 1           | blue            | **frozen**                                    |
| Output | `freezeDestSource` type 2                              | `DestOutMapCol` `FrzMode` 1 | nothing         | not frozen                                    |

- Confirmed by a second run (11:24 to 11:26), each held 20 s with Matt on the monitor: input shows
  active in Toolset but nothing freezes; layer shows in Toolset and freezes; output shows nothing and
  does nothing. Full snapshot after: back to baseline
- Front-panel freeze changed exactly one value in a full snapshot: `listContent` PGM1
  `Layers[0].Freeze` 0 to 1. Toolset on the PDS-4K has no input or output freeze buttons.
- Layer freeze over `changeContent` is not something the module has. It is the only freeze proven on
  the PDS-4K output. Candidate for PR 1 (layer freeze action + feedback from `Layers[].Freeze`)
- Once, the screen read-back straight after an output unfreeze still said `FrzMode 1`; re-read 9 s
  later said 0. Not repeated on the next run
- Implication for PR 1: input and output freeze can't be claimed to work on the PDS-4K.
- **E2 9.2.6373 on a monitor (11:30 to 11:31)**, ScreenDest1X, moving source HDMIInput1X in
  Layer2-B (layer id 3) on program, each held 20 s: **input, layer and output freeze all freeze the
  output and show correctly in Toolset.** Same calls as the PDS-4K table. Full snapshot after: back to
  baseline.
- **E2 aux on a monitor (11:32 to 11:34)**, AuxDest1X, program source HDMIInput1X: aux freeze
  (`freezeDestSource` type 3, aux `FrzMode`) freezes the aux and shows in Toolset; input freeze of
  HDMIInput1X freezes the aux too. Auxes have no layers. **So on the E2 all four freezes work.**
- Matt then added a native background, HDMIBackground1-5 (source id 4, `InputCfgIndex` 2,
  `SrcType` 0), to see whether a background freezes like an input. **E2 background on a monitor
  (11:37 to 11:38)**, input 2 with signal, background on ScreenDest1X program (`BGLyr`
  `LastBGSourceIndex` 0, no layers on program), each held 20 s: `freezeDestSource` type 0 id 4 (as an
  input) and type 1 id 0 (as a background) both freeze the output, Toolset shows the same for both,
  and both set the same field, source 4 `Freeze`. So a native background is an input source as far
  as freeze goes; the module's source freeze covers it. (Background index 0 maps to source id 4 here.)

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
1. Note both frames' IPs, model, firmware (`module-check.js` read-only on each). **The E2 gets a 9.2
   point release first (Matt, 2026-10-16).** Everything verified so far was on 9.2.6318; after the update
   run `module-check --changes` on the E2 before anything else and compare with the 15 Oct results
   (field shapes, notifications, aux arm read-back, `powerStatus`). Label findings by firmware version.
   Upstream proofs run on the updated firmware, and each PR states the firmware it was proven on.
2. Fork module on both: `module-check.js --changes` (freeze, arm, test pattern round trips). PDS-4K has
   no auxes; check whether it has `powerStatus`, which shapes it uses, which notifications fire.
3. Upstream proofs: a harness that loads upstream `9f84de7` (git worktree, shared `node_modules`) and
   drives it against each frame per the table above. Save transcripts under
   `frame-test-kit/results/upstream-proof-*` as evidence.
4. Decide the PR split from the results, then cut branches from upstream master.

## Status

- [x] Fork feature work done and verified on the E2 (freeze, tally, arm, signal, test pattern,
      heartbeat, reboot recovery)
- [x] `module-check.js` ready (rehearsed on mocks only; E2-like and `mock-frame.js --pds`)
- [x] Fork build `4.4.6-ee.21` packaged: listener auto-detect with hint, heartbeat, arm/signal/test
      pattern feedback, aux freeze
- [x] E2 baseline on 9.2.6318 before the point release (2026-10-16 09:32, input 1 with signal): all
      checks OK. `frame-test-kit/results/module-check_E2_9.2.6318_2026-10-16-09-32-32.txt`
- [x] E2 after the point release, **9.2.6373 / OS 3.1.6** (2026-10-16 09:52): all checks OK, same as
      the 9.2.6318 baseline. Same source/screen/aux fields (`DestOutMapCol`/`FrzMode` unchanged; aux
      still has no armed field), same `powerStatus` shape, same notification per change, similar
      timings. The update left the screen armed (`IsActive` 1, so the first run at 09:49 skipped arm);
      Claude unarmed it over JSON-RPC (read-back `IsActive` 0) and reran.
      `frame-test-kit/results/module-check_E2_9.2.6373_2026-10-16-09-52-36.txt`. Upstream proofs on the
      E2 run on 9.2.6373
- [x] PDS-4K at 192.168.0.194, **9.2.5963 / OS 192.5.16**. First run (09:53): 6 checks failed, all
      from one cause (`module-check_PDS-4K_9.2.5963_2026-10-16-09-53-27.txt`). After the fix, screens
      unarmed and input 1 with signal (09:58): **all checks OK**, including source freeze, screen
      freeze, arm toggle and test pattern, one notification each, timings like the E2. But on the
      monitor only layer freeze works: see "Freeze: what the output actually does".
      `frame-test-kit/results/module-check_PDS-4K_9.2.5963_2026-10-16-09-58-54.txt`
  - **Fork bug, fixed: subscribe rejected.** The fork subscribed to 11 types including
    `NativeRateChanged`; the PDS-4K refuses the whole request: `success -1`,
    `"NativeRateChanged is not applicable for PDS."` Probed one type at a time: the other 10 are
    accepted (even `AUXDestChanged`, with no auxes). Upstream subscribes to `ScreenDestChanged` +
    `AUXDestChanged` only, so upstream is not affected: not an upstream claim. Fix (Matt's choice):
    drop `NativeRateChanged` from the module's and the kit's lists; the 5-minute full refresh covers
    native rate changes. `mock-frame.js --pds` now rejects it like the hardware; `npm test` checks the
    module leaves it out. PR 2 must not list it
  - Port 9999 refused a connection (`ECONNREFUSED`) on the request straight after a rejected
    subscribe, twice (module-check and the probe); not seen in the run after the fix. Not chased
  - Shapes match the E2 on 9.2.6318: source `Freeze` + `InputCfgVideoStatus`, screen
    `DestOutMapCol`/`FrzMode`, content `IsActive` + `TestPatternMode`. 2 screens (PGM1, PGM2), 2
    layers, no auxes, 10 inputs. `powerStatus` reports one supply only (`PowerSupply1Status`), so
    `power_status2` shows "Unknown"
  - Frame state found at 09:53: both screens armed; no input had signal (`InputCfgVideoStatus` 4, no
    sync). Claude unarmed both screens over JSON-RPC (read-back `IsActive` 0); input 1 had signal by
    09:58
- [x] PDS-4K freezes rechecked on the monitor (11:24): only layer freeze works
- [ ] **Next:** the E2 on a monitor: input, layer (`changeContent`), output and aux freeze, each held
      20 s
- [ ] Decide what PR 1 claims per model from the monitor results
- [ ] Upstream proof harness written (not started; loads `9f84de7` via a git worktree sharing
      `node_modules`; rehearse on mock for correctness only)
- [ ] Hardware session: module-check on both frames; upstream proofs 1 to 5
- [ ] PR split confirmed; branches cut; PR text drafted (Matt pushes/opens)
