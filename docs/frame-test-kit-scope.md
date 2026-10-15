# Frame test kit: scope

Source of truth for the frame test kit work. Background and open questions (Q1 to Q4) are in
`HANDOFF.md`.

## Objective

A kit Matt runs on the Companion laptop against a blank E2 (192.168.0.175, laptop 192.168.0.100) that
answers, in under 15 minutes of frame time:

- Q1: which JSON-RPC notification types fire for freeze, takes, recalls, layer changes.
- Q2: whether the frame pushes XML on TCP 9876 to a connected client, and what EMT's handshake looks like.
- Q3/Q4: whether `listSources` / `listDestinations` / `listContent` reflect freeze changes made elsewhere.

## Constraints

- The kit changes nothing on the frame: only `subscribe` / `unsubscribe` and read-only calls.
- Windows PowerShell 5.1, no installs. Node comes from Companion's bundled runtime (node18).
- Always cleans up (unsubscribe, stop listener, stop pktmon), including on Ctrl+C.
- Must be rehearsed end to end against a mock before site.

## Design

- `frame-test-kit/kit.js`: the whole guided flow in Node (built-ins only, Node 18). One process, so a
  single listener, socket and snapshot loop. Phases selectable for reruns.
- `frame-test-kit/Run-FrameTests.ps1`: finds node, does the Windows-only checks (admin, network
  profile per interface, firewall rule), optionally sets the profile Private and offers to revert,
  then runs `kit.js`. pktmon is driven from `kit.js` (needs admin).
- Every operator step: listener events, 9876 bytes and a read-only state snapshot (sources,
  destinations, screen/aux content) are attributed to the step, and the snapshot is diffed against the
  previous one. This folds Q3/Q4 into every step and Phase B (passive 9876) into Phase A.
- pktmon filters on the frame's IP, not just port 9876, so traffic on any port EMT uses is captured.
- `frame-test-kit/mock-frame.js`: mock JSON-RPC (behaves like 9.2: only PresetChanged and
  ScreenDestChanged fire), a 9876 endpoint that pushes XML or stays silent, and a rehearsal-only control
  endpoint so `kit.js --auto` can simulate the operator.
- `test/kit.test.js`: automated rehearsal in `npm test`.

## Status

- [x] Scope, mock frame, kit.js, Run-FrameTests.ps1, FRAME-PREP.md, README.md
- [x] Rehearsed: `test/kit.test.js` (26 checks, in `npm test`), keyboard path with piped input,
      wrapper `-Rehearsal` on Companion's node26; kit code also run on node18
- [x] Smoke run against the real blank E2 (2026-10-15, read-only plus subscribe/unsubscribe):
      9.2.6318, OS 3.1.5, 0 sources; 9999 and 9876 reachable; subscribe returns success 0
- [ ] Site session: prep, Phase A, Phase C; results folder sent back
- [ ] Decide implementation per the HANDOFF.md decision tree

## Notes

- The laptop's network to the frame is "Unidentified network", Public. The firewall rules "Companion EM
  notifications" and "Bitfocus Companion (node18)" are Any-profile, so Public may be fine; A1 proves it.
- The wrapper prefers Companion's newest bundled node (node26, then node22, then node18).
- Not exercised: pktmon capture (needs admin and EMT), Set-NetConnectionProfile, firewall rule creation.
