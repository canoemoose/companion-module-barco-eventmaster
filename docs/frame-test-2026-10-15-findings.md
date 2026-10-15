# Frame test findings, 2026-10-15

Frame: Barco E2, firmware **9.2.6318**, OS 3.1.5, 192.168.0.175 (blank warehouse frame, programmed per
`frame-test-kit/FRAME-PREP.md` during the kit's Prep phase). Inputs had signal (1080p50 and 1080p59.94).
Raw results: `frame-test-kit/results/E2_9.2.6318_2026-10-15-13-01-20/` (not committed: gitignored, about 8 MB).

Only one laptop was available, so Phase C steps 3 to 6 (changes from a second client, EMT's own
outbound commands, the EMT Ctrl+O log) were not run. Phase A steps A5 and A16 were skipped.

## Headline

**The frame pushes state deltas on TCP 9876 to any connected client, unsolicited.** The kit's socket
sent nothing at all and still received every change made in EMT: source, screen and aux freeze, layer
PGM/PVW state on takes, preset recall, renames, input config. No handshake or registration needed.
This is the preferred branch of the HANDOFF decision tree: implement an XML push client.

## Q2: XML on 9876

- 398 messages, about 2.7 MB over roughly an hour of programming and testing. The connection stayed
  up the whole time (no close from the frame). No keepalive traffic observed.
- **Framing:** each message is one `<System id="0"> ... </System>` document followed by `\n`. 19 of
  398 were split across two TCP reads, so the client must buffer and split on `</System>`. None
  arrived concatenated in this sample, but the parser should allow for that too.
- Messages are deltas keyed by `id` attributes, e.g. source freeze:
  `System/SrcMgr/InputCfgCol/InputCfg[id]/FrzMode`. Creations arrive under an `<Add>` element.
- `GuiId` identifies the originator: `<12 hex>-<seq>`. `3c0af3da3620` was this laptop's EMT; the
  frame's own MAC `00139515e54c` appeared for frame-originated changes. Possibly useful for
  ignoring echoes of our own changes.
- **Noise:** every auto transition streams `Transition/TransPos` (about 30 messages per take), and layer
  geometry (`WinAdjust`, `PIP`) is chatty. Parse only the fields we need.

| State                      | XML path (ids in brackets)                                                     |
| -------------------------- | ------------------------------------------------------------------------------ |
| Source (input) freeze      | `SrcMgr/InputCfgCol/InputCfg[input]/FrzMode`                                   |
| Screen freeze (per output) | `DestMgr/ScreenDestCol/ScreenDest[dest]/DestOutMapCol/DestOutMap[out]/FrzMode` |
| Aux freeze                 | `DestMgr/AuxDestCol/AuxDest[aux]/FrzMode`                                      |
| Layer on PGM / PVW         | `.../ScreenDest[dest]/LayerCollection/Layer[n]/PgmMode`, `PvwMode`             |
| Layer source               | `.../Layer[n]/LastSrcIdx`, `AppliedSrcIdx`, plus `LayerCfg/Source/Name` etc.   |
| Transition running         | `.../ScreenDest[dest]/Transition/TransInProg`, `AutoTransInProg`               |

Note source freeze is keyed by **InputCfg** index, not source id (they matched here: source 0 = input 0).

## Q1: JSON-RPC notifications (all 11 types subscribed)

On this frame, unlike the first, notifications **do** fire for live state:

| Action                   | Notifications                                              |
| ------------------------ | ---------------------------------------------------------- |
| Source freeze / unfreeze | `InputCfgChanged` (1 each)                                 |
| Screen freeze            | `ScreenDestChanged`                                        |
| Aux freeze / unfreeze    | `AUXDestChanged`                                           |
| Take (auto trans)        | `ScreenDestChanged` x30 (one per transition frame)         |
| Preset recall to PVW     | `ScreenDestChanged`, `AUXDestChanged`, `PresetChanged`     |
| Source rename            | `SourceChanged`, `InputCfgChanged`                         |
| Input config change      | `InputCfgChanged` (one per adjustment)                     |
| Still capture            | `StillChanged`, `SourceChanged`, `BGSourceChanged`, others |

The module's `NOTIFY_EVENTS` doesn't include `InputCfgChanged`, so source freeze would be missed even
by the JSON route. Why the first frame looked different is unknown: it never subscribed
`InputCfgChanged`, and stale test subscriptions may have muddied it. Both frames report 9.2.

## Q3: read-back of freeze via JSON-RPC

- `listSources[].Freeze`: correct (0 -> 1 -> 0 with source freeze).
- **Bug: screen freeze is not where the module looks.** The frame returns
  `ScreenDestination[].DestOutMapCol.DestOutMap[].FrzMode`: `DestOutMapCol` (single L) is an
  **object**, and the field is `FrzMode`. The module reads `DestOutMapColl[]` (array) and `.Freeze`, per
  Barco's 8.2 doc. So externally made screen freezes are never seen; Companion-made ones only show via
  the optimistic update. The test mock copied the same wrong shape.
- Aux: `AuxDestination[].FrzMode` (no `Freeze` field).

## Q4: layer `Freeze` in listContent

Source freeze did **not** change any layer's `Freeze` in `listContent`, so the tally code's
`layer.Freeze === 0` filter is unaffected by source freeze.

## Naming and filter

Auto-generated names (`HDMIInput1-1`, `HDMIInput2-2`) end in `-N`: label rule holds. The re-entry
source `ScreenDest1_PGM-3` has `DestIndex 0` and is excluded by the filter, as intended.

## Not tested

- Whether changes made **via JSON-RPC** (i.e. from Companion) are also pushed on 9876. Very likely,
  and testable with one laptop: enable Companion, keep the kit's 9876 socket open, press a freeze button.
- How many concurrent 9876 clients the frame accepts (EMT and the kit coexisted fine).
- Behaviour across a frame reboot (socket reconnect) and on older firmware.
- `emt-capture.pcapng` (EMT's connect sequence) is captured but not analysed: no tshark on this PC,
  and the push needs no handshake anyway.

## Next

1. Fix the screen freeze read path (`DestOutMapCol` object, `FrzMode`), keeping `DestOutMapColl` /
   `Freeze` as a fallback for other firmware. Fix the mock and tests to the real shape.
2. Implement the XML push client: persistent TCP 9876, stream split on `</System>`, reconnect with
   backoff, parse only freeze/layer/transition paths, update state and `checkFeedbacks`. Keep JSON-RPC
   for actions and the structural refresh. Fall back gracefully if 9876 is closed.
3. Quick check with Companion enabled that JSON-RPC-made changes also arrive on 9876.
