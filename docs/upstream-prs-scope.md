# Upstream PRs: scope

Source of truth for turning the fork's work into upstream PRs to `bitfocus/companion-module-barco-eventmaster`.
Upstream base: v4.4.5, commit `9f84de7`. Fork branch: `feature/freeze-toggle-feedback` (latest build
`4.4.6-ee.25`; fork builds are `<upstream next patch>-ee.N`, so they sort above upstream 4.4.5 and below its next release. Older `4.5.0-freeze.N` builds sort higher: remove them from Companion). Background: `HANDOFF.md`, `docs/frame-test-2026-10-15-findings.md`.

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
- **PR text opens with** (Matt, 2026-10-16): "Generated with Claude Code;
  Claude writes better JavaScript than I do. Tested against actual hardware." No footer. Drafts live
  in `docs/prs/`.
- **Naming in PR text** (Matt): the device is "the frame" or "the Event Master frame", two words in
  prose. `EventMaster` / `eventmaster` only where it is code (`barco-eventmaster`, `eventmaster.js`).
  HELP.md keeps upstream's own "EventMaster"
- **Existing buttons**: where a PR changes a preset's action options, it ships an upgrade script so
  buttons already made from it are fixed (Matt). A preset that only gains a feedback can't be
  upgraded; say so in the PR text. Upgrade scripts are indexed by Companion: keep the fork's
  `upgrades.js` in the same order as upstream's.

## Proposed PRs

1. **Freeze control and feedback** (new feature). Source/screen/aux freeze toggle actions, frozen
   feedbacks, `*_frozen` / `*_label` variables, freeze presets, live-input-only dropdowns. Screen freeze
   reads `DestOutMapCol`/`FrzMode` with `DestOutMapColl`/`Freeze` fallback. Works with plain polling.
   Plus **layer freeze** (`frz_layer_toggle`, `layer_frozen`, `screen_S_layer_N_pgm_frozen` /
   `_pvw_frozen`, "Freeze Layers" presets). One entry per layer, grouped by Z order; **the bus picks
   whatever of the layer is on it at press time** (Matt, 2026-10-16): program = `PgmMode 1`, preview
   = `PvwMode 1`. **Freeze belongs to the physical layer, never the bus** (Matt): a single (E2) or
   split (PDS-4K) layer on program reads both modes, is one layer, and can't be frozen on one bus
   only, so it counts for both: both feedbacks show its state and either button changes it. Only a
   mixing pair can differ by bus (two physical layers). Toggle unfreezes if any is frozen, else freezes all, in one
   `changeContent`; feedback true if any is frozen. Chosen because JSON-RPC doesn't say whether a
   PDS-4K layer is split: a split layer with both halves on program freezes both. And on a **PDS-4K** (`FrameType` 6) the fork's source/screen freeze toggles,
   feedbacks, presets and variables are hidden, and so are upstream's `frz_Source`/`freeze_dest`
   (Matt, 2026-10-16; claim 6 must prove they don't work there). Proven on the output: E2 9.2.6373 input, layer, output, aux, background; PDS-4K
   9.2.5963 layer only.
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

| Freeze | JSON-RPC                                        | Read-back                   | Toolset        | Output     |
| ------ | ----------------------------------------------- | --------------------------- | -------------- | ---------- |
| Input  | `freezeDestSource` type 0                       | source `Freeze` 1           | green on layer | not frozen |
| Layer  | `changeContent {id, Layers: [{id, Freeze: 1}]}` | layer `Freeze` 1            | blue           | **frozen** |
| Output | `freezeDestSource` type 2                       | `DestOutMapCol` `FrzMode` 1 | nothing        | not frozen |

- Confirmed by a second run (11:24 to 11:26), each held 20 s with Matt on the monitor: input shows
  active in Toolset but nothing freezes; layer shows in Toolset and freezes; output shows nothing and
  does nothing. Full snapshot after: back to baseline
- **Layers (Matt):** a mixing layer is an A/B pair, one on program and one on preview, swapping on a
  transition; a layer frozen on preview stays frozen through the transition. A **single layer** is
  added as such (not split from a pair): it can only be transitioned on or off program, and while it
  is on program a preview change hits program instantly. In `listContent` (E2 9.2.6373) a single
  layer is one entry with no `-A`/`-B` suffix (`Layer3`); `LinkLayerId` is -1 for all. **A pair
  shares `PgmZOrder`/`PvwZOrder`, a single layer's is unique** (E2: Layer1-A/B 0, Layer2-A/B 2,
  Layer3 4; PDS-4K: LayerA/B both 0). Names differ by model (`Layer1-A` vs `LayerA`), so pair by Z
  order, not by name. Layer checks, E2 9.2.6373 on a monitor (11:49 to 11:52):
  1. **Notification**: a layer freeze and its release each send one `ScreenDestChanged`
     `update: [0]`, which the module already answers with a `listContent` read
  2. **Through a transition**: Layer2-B frozen on preview, Matt transitions in EMT: Layer2-B is now
     `PgmMode 1` and still `Freeze 1`, frozen on the output; Layer2-A takes preview unfrozen. Freeze
     belongs to the physical layer, so resolving program/preview at press time picks the right one
  3. **Single layer on program** reads `PgmMode 1` and `PvwMode 1` together (a pair never does);
     freezing it froze the output
  4. **PDS-4K split layer** (9.2.5963, PGM1, 12:19 to 12:24): splitting LayerA/B changes nothing
     structural over JSON-RPC: same names, both still Z 0/0, `LinkLayerId` and `listDestinations`
     unchanged. Only the modes show it. Pair on program A `Pgm 1 Pvw 0` / B `Pgm 0 Pvw 1`; split,
     both on preview: both `Pgm 0 Pvw 1`; split, B on program: A `Pgm 0 Pvw 1`, B `Pgm 1 Pvw 1`;
     split, both on program: both `Pgm 1 Pvw 1`; **still split** (12:24), both taken off program: A
     `Pgm 0 Pvw 0`, B `Pgm 0 Pvw 1`, which is exactly the pattern of a pair off program. So split vs
     pair can't always be told from the modes. `getFrameSettings` (about 1 KB, no layer fields) and
     `listDestinations` type 1 (same as type 0) checked at 12:29 while split. **Split (12:31) vs
     unsplit (12:32), everything read** (sources, destinations type 0 and 1, all content, frame
     settings): only LayerB's source and window moved; modes both `Pgm 0 Pvw 0` in each. **JSON-RPC
     does not expose whether a PDS-4K layer is split.**
  5. **Reorder**: mixing layers reorder only among mixing layers and singles among singles; a layer's
     position is set by creation order. Matt: a pair's halves always keep one Z order. Not observed:
     the swap wouldn't apply on the frame
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

| #        | Claim (from reading `9f84de7`)                                                                                                                      | Code                                         | Proof on hardware                                                                                                                                    |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1        | Aux test pattern presets do nothing: presets set `screenDestination`, the `testpattern_on_AUX` action reads `auxDestination`, so it sends `id: NaN` | `presets.js` ~634, `eventmaster.js` ~1458    | Run upstream preset action against the E2 (has an aux): capture the request, frame reply, and the aux test pattern unchanged. PDS-4K has no aux: N/A |
| 2        | "Unsubscribe to start clean" is a no-op: `this.eventmaster.unsubscribe(callback)` (callback in the hostname slot, no port/types)                    | `eventmaster.js` ~248                        | Capture the request and frame reply. Then show a leftover subscription from a previous run still delivers (frame keeps notifying the old port)       |
| 3        | Live updates can't restart: teardown never stops the notification server, so setup again (config change) hits address in use                        | `eventmaster.js` ~312, listener `start()`    | Upstream module: enable live updates, change config (re-init), record outcome; does a notification still arrive afterwards?                          |
| 4        | If the notification port is taken, the module process crashes (listener error unhandled)                                                            | listener / `startNotificationServer`         | Hold the port, enable live updates against a real frame, record whether the module process dies                                                      |
| 5 (open) | Upstream subscribes with a numeric port; does the frame accept it?                                                                                  | listener line 40                             | Subscribe with number vs string, check `success` and whether notifications arrive. Only claim if it fails                                            |
| 6        | On a PDS-4K upstream's "Freeze/Unfreeze Source" (`frz_Source`) and "Freeze/Unfreeze Destination" (`freeze_dest`) don't freeze the picture           | `eventmaster.js` `frz_Source`, `freeze_dest` | Run upstream's two actions against the PDS-4K, Matt on the monitor with a moving source; control: a layer freeze does freeze. Justifies hiding them  |

The behaviour each proof rests on (the reply is only supporting):

- 1: the aux output shows no test pattern (Matt watching), and an independent read-back of the aux
  shows `TestPatternMode` 0. Control: the same pattern sent with the right option does appear.
- 2: after the "clean" unsubscribe, a subscription left by a previous run still receives
  notifications (a listener on the old port gets them when Matt changes something).
- 3: after re-init, notifications no longer arrive at the module (and the error it hits).
- 4: the module process exits.
- 5: notifications arrive (or don't) with a numeric port versus a string port.
- 6: the PDS-4K output stays live through each upstream freeze action (Matt watching), while the
  read-back flips; the layer freeze control freezes it. Already seen with direct JSON-RPC calls
  (2026-10-16 11:24); still to repeat through upstream's own code.

### Results (2026-10-16, harness `frame-test-kit/upstream-proof.js`)

The harness runs upstream `9f84de7` unchanged from a git worktree (`../eventmaster-upstream-9f84de7`,
on this repo's `node_modules`; same dependency ranges), logs every JSON-RPC request and reply, every
notification and which numbered upstream server got it, and the module's log. Transcripts:
`frame-test-kit/results/upstream-proof-<claim>_<frame>_<version>_<UTC time>.txt` (results are
gitignored: copy the ones a PR cites). Run on Windows, Companion's node18 (v18.20.8). Screen 0's arm is
toggled and put back to make the frame send `ScreenDestChanged`.

Reading the code again before running changed two claims:

- **1 is narrower**: of upstream's 21 aux test pattern presets only the **Off** preset (`testPattern
0`) sends `screenDestination`; the other 20 send `auxDestination`. Claim: the aux Off preset sends
  `id: NaN` (JSON `null`). What the frame does with that is to be watched
- **3 and 4 don't crash**: since Express 5 (upstream locks 5.2.1; here 5.3.0) `app.listen` hands a
  listen error to its callback, and `barco-eventmaster`'s callback ignores it and logs "listening"
  anyway. Plain Node on this PC does raise `EADDRINUSE` for both cases (checked)

| #   | E2 9.2.6373                                                                                                                                                                                                                                                                                                                                                                                                 | PDS-4K 9.2.5963                                                         | Verdict                                                                                       |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| 2   | Upstream sends `unsubscribe` with `hostname` = the callback and no port or types; on the wire `{}`. Frame rejects it: JSON-RPC error -32603 `TypeError: Cannot call method 'forEach' of undefined` (the library drops `error`, so upstream's "Unsubscribe completed" never logs). A previous run's subscription got 2/2 notifications after upstream's clean start; control: 0/2 after a proper unsubscribe | Same; error `Cannot read property 'indexOf' of undefined`; 2/2 then 0/2 | **Proven** on both                                                                            |
| 3   | Config save, same port: server #2 `EADDRINUSE`, silently (module logs nothing wrong); leaked server #1 keeps receiving, so updates continue by accident. Port changed 3006 -> 3007: #3 listens and receives, and the old port 3006 still answers HTTP 200 (server #1 never closed)                                                                                                                          | Same                                                                    | **Proven, reworded**: teardown leaks the notification server; a later listen fails silently   |
| 4   | Port held by another process: upstream's server `EADDRINUSE` silently; module status `ok`, process keeps running (no crash); the frame's notifications arrive at the other process instead (2/2)                                                                                                                                                                                                            | Same                                                                    | **Proven, reworded**: live updates fail silently and the other process gets the notifications |
| 5   | Numeric port accepted (`success 0`) and notified 2/2, same as a string port                                                                                                                                                                                                                                                                                                                                 | Same                                                                    | **Refuted**: not a bug, drop from the PRs                                                     |

- **1, E2 9.2.6373 (15:15, Matt on AuxDest1X): proven.** Upstream's `test_pattern_Off_0` preset
  carries `{"screenDestination":"0","testPattern":"0"}`; its action sends `changeAuxContent
{"id":null,"TestPattern":0}`; the frame answers `success -1`, `"Aux dest. id = null Not Found"`.
  Colour bars (put on from another client at 15:15:09) stayed on the output through it, and read-back
  stayed `TestPatternMode 3` 20 s later; the control (same action with `auxDestination`) cleared them
  at 15:15:31, read-back 0. The PDS-4K has no aux: N/A.

- **6, PDS-4K 9.2.5963 (15:20 to 15:22, Matt on PGM1, moving HDMIInput1 in LayerB on program):
  proven.** Upstream's `frz_Source` (`freezeDestSource` type 0, source 0) held 20 s: read-back
  `Freeze 1`, output stayed live. Upstream's `freeze_dest` (type 2, screen 0) held 20 s: read-back
  `FrzMode 1`, output stayed live. Control, layer freeze (`changeContent` LayerB `Freeze 1`) held
  20 s: output froze. Justifies hiding both on a PDS-4K.

**All six claims run.** For the PRs: 1, 2, 3 (reworded), 4 (reworded) and 6 proven, each with the
firmware it was proven on; 5 dropped.

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
- [x] E2 on a monitor: input, layer, output, aux and background freeze all work (11:30 to 11:38)
- [x] Layer freeze built (fork `4.4.6-ee.22`): see PR 1. `test/layer.test.js` covers grouping,
      program/preview resolution through a transition, single layers, a layer not on program, new
      layers rebuilding dropdowns, and PDS-4K hiding. module-check now runs a layer freeze round trip
      through the Companion action: both frames all checks OK (2026-10-16 12:09 local;
      `module-check_E2_9.2.6373_2026-10-16-11-09-17.txt`, `module-check_PDS-4K_9.2.5963_2026-10-16-11-09-24.txt`,
      UTC in the names)
- [x] Layer rule changed to "bus picks what's on it" and upstream's freeze actions hidden on a PDS-4K
      (fork `4.4.6-ee.23`; `-ee.22` superseded, never tested in Companion). Tests add the split
      PDS-4K cases. A two-layer `changeContent` (E2 Layer2 + Layer3, 12:36) set and cleared both by
      read-back; **not yet seen on an output**: watch a split PDS-4K layer with both halves on
      program freeze together. module-check 12:37 both frames all checks OK; the PDS-4K had nothing
      on program, so its layer step was skipped
- [x] Layers on both buses count for both (fork `4.4.6-ee.24`; `-ee.23` superseded, never tested in
      Companion). module-check 12:56 both frames all checks OK; PDS-4K PGM1 was split with B on both
      buses, and the layer round trip froze and released B
- [x] Matt checked `4.4.6-ee.24` in Companion (13:00 to 13:20): **PDS-4K yes** (no source/screen
      freeze offered; split PGM1 frozen from the program button lights both feedbacks; both halves on
      program freeze together, so the two-layer `changeContent` is now seen on an output). **E2
      mixing layers good.** E2 single layer: a hand-made preview button kept lighting after Layer3
      was cleared from preview; cause was its feedback's own bus option still on Program (action and
      feedback each have one). Frame read-backs were right throughout (13:16 `Pgm 1 Pvw 0`), and
      clearing/taking layers sends `ScreenDestChanged` (87 in 2 min, in bursts of about 30)
- [x] Preview presets added (fork `4.4.6-ee.25`): a program and a preview button per layer, action and
      feedback bus set together; button text ends `L<n> PGM` / `L<n> PVW`
- [ ] **Next:** Matt checks the `-ee.25` preview presets on the E2 single layer; then commit
- [x] Upstream proof harness written (`frame-test-kit/upstream-proof.js`; worktree
      `../eventmaster-upstream-9f84de7`, kept for reruns; rehearsed on the mock first)
- [x] Hardware session: module-check on both frames; upstream proofs 1 to 6 (see "Results"). Claims
      2, 3, 4 on both frames; 1 on the E2 (only it has an aux); 6 on the PDS-4K
- [ ] **Next:** decide the PR split from the results (claim 5 out; 3 and 4 reworded), then cut
      branches from upstream master and draft PR text
- [ ] PR split confirmed; branches cut; PR text drafted (Matt pushes/opens)
