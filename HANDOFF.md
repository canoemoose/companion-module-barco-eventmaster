# Handoff: barco-eventmaster Companion fork (freeze feedback + live state)

Fork of `bitfocus/companion-module-barco-eventmaster` (base: v4.4.5, commit `9f84de7`).
Branch: `feature/freeze-toggle-feedback`. Owner: Matt.

## The next job

Build a **frame test kit** that answers the open questions below in the **shortest possible
time on a live frame** (target: under 15 minutes of frame access, one session). Matt has no frame
access for a few days. The kit must be rehearsed end to end against a mock frame before site.

Then, depending on results, implement the winning approach in the module (see Decision tree).

## Hard constraints

- **No regular polling of a show-critical frame.** Matt does not want the module adding periodic
  load. The fast state poller exists but is **off by default** (`statePollInterval` = 0) and must stay
  opt-in. Prefer push or event-driven approaches.
- The test kit itself must not change frame state. Only `subscribe` / `unsubscribe` and read-only
  calls; anything that changes the show is done by the operator by hand when prompted.
- Companion host is **Windows**. The kit should run in Windows PowerShell 5.1 with no installs
  (PowerShell 7 OK if it also works in 5.1). Admin is available.
- Companion runs modules in its bundled runtime:
  `C:\Program Files\Companion\resources\node-runtimes\node18\node.exe` (Node 18 — keep module
  code Node 18 compatible).

## What is done (7 commits on the branch, plus this handoff commit)

- **Freeze Source (Toggle)** and **Freeze Screen Destination (Toggle)** actions (Toggle/Freeze/Unfreeze),
  using frame-reported state. Optimistic update on success, then confirmed by re-reading.
- **Source Frozen** / **Screen Destination Frozen** boolean feedbacks (screen: any/all outputs).
- Variables: `source_N_frozen`, `screen_N_frozen` (Yes/Partial/No), `source_N_label`, `screen_N_label`.
- Presets: _Freeze Sources_, _Freeze Screen Destinations_. Text `Freeze\n<label>`, frozen style blue
  with `FROZEN\n<label>`. Matt approved this format.
- Labels strip exactly one trailing `-<digits>` (the frame appends the source/input number to every
  name, e.g. `Cam 1-1` → `Cam 1`). Confirmed on the first frame: all source variables end in `-N`;
  the number is shown under inputs in the EM UI. The kit should re-check this on the next frame.
- Freeze presets/dropdowns list **live inputs only**: `InputCfgIndex >= 0`, and not `DestIndex >= 0`
  or `UserKeyIndex >= 0` (destinations re-entered as sources were appearing). Confirmed working on the first frame.
- Live updates reworked (`tools/notification-listener.js` rewritten):
  subscribe result checked and exposed; listener errors (EADDRINUSE etc.) reported and not masked by a
  later successful subscribe; teardown unsubscribes the same port/events and stops the server (fixes
  stock 3000 vs 3004 mismatch); listener IP auto-detect prefers the frame's subnet; resubscribe every
  10 min and when the frame returns after an outage. Notifications trigger a structural refresh.
- Optional fast state poller (`statePollInterval`, default 0/off) with outage detection, single log
  line per outage, `frame_connection` variable.
- Status variables: `frame_connection`, `live_updates_status`, `live_updates_last`.
- Original Freeze/Unfreeze actions untouched (backwards compatible).

Tests: `npm test` runs `test/freeze.test.js` (39 checks) and `test/live.test.js` (29 checks) against an
in-process mock frame on `127.0.0.1:9999`. Both pass.

Build: `npm run package` (runs `companion-module-build`) → `barco-eventmaster-<version>.tgz`, imported
via Companion Modules → Import module package.

**Package manager: Matt uses npm.** Upstream uses yarn and ships a `yarn.lock`; upstream's
`.gitignore` excludes `package-lock.json`. npm will rewrite `yarn.lock` on install. Do **not** commit
`yarn.lock` changes (they'd pollute an upstream PR): `git checkout -- yarn.lock` after installing, or
`git update-index --assume-unchanged yarn.lock`. Whether to commit a `package-lock.json` for the fork
is Matt's call; ask before changing `.gitignore`.

## Findings from the first frame (confirmed by Matt)

**The next test session is on a different frame.** Treat everything in this section as what _that_
frame did, not as facts about the next one. Firmware, cards, network and notification behaviour may
all differ, so the kit must detect and record them rather than assume.

| Item              | Value                                                                                    |
| ----------------- | ---------------------------------------------------------------------------------------- |
| Frame             | Barco Event Master E2, firmware **9.2.x** (first frame only)                             |
| Frame IP          | 192.168.0.180                                                                            |
| Companion PC      | Windows, 192.168.0.15, network profile set to Private (may not be the same PC next time) |
| Notification port | 3000 (inbound firewall rule added on that PC, RemoteAddress **Any**)                     |
| MVR card          | No Gen 2 HDMI card on that frame. **TSL is ruled out regardless**: it can't carry freeze |

Diagnosis history for live updates (so it isn't repeated):

1. Listener IP auto-detected correctly (same /24 as frame).
2. Inbound blocked at first; fixed by setting profile Private + firewall rule. A rule scoped to
   `RemoteAddress 192.168.0.180` made a test from another machine fail (expected); widened to Any.
   `AllowLocalFirewallRules` = True on all profiles (no GPO override).
3. Manual `subscribe` returns `success: 0`.
4. Raw TCP listener + manual subscription showed what the frame actually pushes on 9.2:
   - **Fires:** `PresetChanged` (preset save/delete), `ScreenDestChanged` (screen destination rename)
   - **Does not fire:** source rename (`SourceChanged`), freeze/unfreeze, preset recall and layer
     changes (recall observed implicitly: only save/delete produced traffic)
   - Subscribed but not yet seen: `AUXDestChanged`, `FrameChanged`, `CueChanged`
   - **Never subscribed:** `InputCfgChanged`, `BGSourceChanged`, `OutputCfgChanged`,
     `NativeRateChanged`, `StillChanged`

So on 9.2 the JSON-RPC notifications cover structure, not live state. That is the core problem.

Stale state on the first frame: several manual subscriptions from testing may still exist (no API to
list them). Not relevant to the next frame, but the kit should still unsubscribe its own host/port
before subscribing, in case of a previous aborted run.

## Open questions for the frame session

- **Q1.** Do any of the never-subscribed JSON types fire on freeze or on takes? `InputCfgChanged` is the
  best candidate for freeze. Also re-check `SourceChanged` / `ScreenDestChanged` against each action.
- **Q2.** Does the frame **push** state changes over the XML protocol on **TCP 9876**? Event Master
  Toolset (EMT) uses this protocol and updates instantly when another client freezes or takes. Either
  the frame pushes deltas to connected clients (ideal: freeze and tally without polling) or EMT polls.
  Unknowns: whether a connected client must send a handshake/registration first, what the pushed XML
  looks like, whether it includes freeze and layer source/PGM state.
  - The separate Companion module `bitfocus/companion-module-barco-eventmaster-xml` (package name
    `barco-dp`) only _sends_ XML on 9876 using `<System id="0" GUID="..."> ... </System>` wrappers;
    it never reads. Its HELP notes EMT shows the XML it sends with **Ctrl+O**.
- **Q3.** Confirm `listSources` returns `Freeze` correctly on 9.2 for a source frozen from EMT, and
  `listDestinations` `DestOutMapColl[].DestOutMap[].Freeze` for a frozen screen. (Feedback appeared to
  work on the first frame, but external-change behaviour wasn't checked rigorously.)
- **Q4.** Does `freezeDestSource` type 0 (source) affect the `Freeze` field on layers in `listContent`?
  (Existing tally code excludes frozen layers.)

## Test kit spec

Deliver a single folder Matt can copy to the Companion PC, e.g. `frame-test-kit/`:

1. **`Run-FrameTests.ps1`**: one guided script. Config block at top (frame IP, local IP, port,
   output path). Phases:
   - **Nothing hardcoded.** Frame IP, local IP (auto-pick the interface on the frame's subnet, show it,
     allow override), port and auth (operator ID / super user password, if the frame uses them) are
     prompted or taken from parameters. No values from the first frame.
   - **Frame identification** (read-only, first thing, saved to results): model, firmware/OS version,
     MAC (`getFrameSettings`), card/slot info if the API exposes it (check `listInputs`/`listOutputs`
     or frame settings), counts of sources/screens/auxes. The 9.2 findings only transfer if this matches.
   - **Preflight** (no frame changes): frame reachable on 9999 (a read-only JSON call) and 9876 (TCP
     connect only); local port free; network profile and an inbound firewall rule for the port. This
     may be a different PC: offer to set the profile to Private and add the rule (admin), and record
     what was changed so cleanup can undo it. Warn that the Companion EM connection must be disabled
     for the duration.
   - **Naming/filter checks** (read-only): report source names that don't end in `-<digits>`, and
     sources with `DestIndex >= 0` or `UserKeyIndex >= 0`, to confirm the label and filter rules hold
     on this frame.
   - **Phase A, JSON notifications:** start a TCP listener in a background runspace/job that logs every
     inbound request with timestamp and parsed `notificationType`/`change`. Subscribe **all 11** types
     (port as string). Then prompt through a short action list; for each step: show the instruction,
     wait for Enter, wait ~3 s, record which types arrived in that window. Suggested steps (operator
     does them in EMT): freeze a source; unfreeze; freeze a screen; unfreeze; take/cut on a screen;
     recall a preset to PVW; change a layer's source; rename a source; change an input config setting;
     capture or delete a still; change a background; rename an aux; save a preset (positive control).
     Also take a `listSources`/`listDestinations` snapshot before and after the freeze steps (answers
     Q3/Q4 read-only).
   - **Phase B, XML 9876 passive:** open a TcpClient to 9876, send nothing, log any bytes received while
     the operator repeats freeze and take from EMT. If nothing arrives, Phase C decides whether a
     handshake is needed.
   - **Phase C, EMT traffic capture:** if EMT runs on the same PC, use built-in **pktmon** (no install):
     filter port 9876, capture while the operator freezes from **Companion or a second EMT** (not this
     EMT), so any inbound XML at this EMT is unsolicited push. Convert with `pktmon etl2pcap` for
     Wireshark. Provide a short checklist if Wireshark is used on a different machine instead.
     Also ask the operator to open EMT's Ctrl+O XML log and save it, to capture EMT's own outbound
     messages (handshake/GUID format).
   - **Cleanup (always, including on Ctrl+C / error):** unsubscribe everything subscribed, stop
     listener, stop pktmon, close sockets. Offer to undo any PC changes the preflight made (firewall rule, network profile).
   - **Output:** one results folder named with frame model, firmware and timestamp: `results.md`
     (frame identification, action × notification matrix, XML received yes/no, snapshot diffs,
     naming/filter checks) plus raw logs and the pcap. Matt sends this back.
2. **Mock rehearsal:** a Node (or PowerShell) mock frame implementing the JSON-RPC calls used, pushing
   configurable notifications, plus a fake 9876 endpoint that can be set to push or stay silent, so the
   whole script can be run end to end locally before site. Reuse the mock in `test/live.test.js`.
3. **`README.md`**: one page, what to do in what order, expected duration per phase, what to send back.

Keep it fast: no long fixed waits, Enter-to-advance, a "skip" option per step, and the ability to rerun
a single phase.

## Decision tree after the session

If the test frame's firmware differs from 9.2, note that results may not hold for the first frame
(or for show frames on other versions). Any implementation should degrade gracefully: detect what
the connected frame supports rather than assuming.

- **XML 9876 pushes freeze and layer/PGM state:** implement an XML push client in the module (persistent
  TCP, handshake as captured, reconnect with backoff, parse deltas → update freeze + tally state,
  checkFeedbacks). Keep JSON-RPC for actions. This is the preferred outcome.
- **A JSON type fires on freeze and/or takes:** on that notification, do a _targeted_ read (only the
  affected source/destination: `listSources`, or `listContent` for the ids in `change`) instead of a
  full refresh.
- **Neither:** event-driven fallback with no added periodic load. Companion-initiated changes are already
  instant (optimistic + confirm read). Optionally a short burst of confirmation reads after a Companion
  take. External changes follow the existing 15 s poll. Fast state poller stays off.

## Housekeeping before an upstream PR

- Squash into one or a few logical commits.
- Remove leftover unused fields in `init()` (`_notifyTimer`, `_notifyNoEventTimer`).
- Consider a config upgrade script if config field ids change.
- Note in the PR that on EM 9.2 JSON notifications are structural only.

## Code map

- `eventmaster.js`: module. Freeze helpers (`buttonLabel`, `isFreezableSource`, `isSourceFrozen`,
  `isScreenFrozen`, `refreshFreezeState`, `sendFreeze`); live updates (`setupNotifications`,
  `teardownNotifications`, `resubscribeNotifications`, `refreshStructure`, `getNotificationHost`);
  state poller (`startStatePoller`, `statePollTick`); source tally (`autoPopulateSourceMonitoring`).
  Actions `frz_source_toggle`, `frz_screen_toggle`; feedbacks `source_frozen`, `screen_frozen`.
- `tools/notification-listener.js`: subscription listener (debounce, onPull/onSubscribed/onError).
- `presets.js`: freeze presets at the end.
- `docs/JSON_RPC_with_EM_processors_Doc_8_2.docx`: Barco's JSON-RPC reference (notification types,
  `listSources` Freeze field, `listDestinations` DestOutMap Freeze).
- `test/`: mock-frame test suites.

## Working with Matt

Prefers autonomous execution with batched questions, ending with a summary of changes, assumptions and
flags. If unsure whether a task is autonomous or interactive, ask one short question.
