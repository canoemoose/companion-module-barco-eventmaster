# PR B: freeze control and feedback

Branch `feature/freeze-control-feedback` (worktree `../pr-b-freeze`), from upstream master `9f84de7`.
Commit `19f3e8d`. Standalone: no dependency on PRs A, C or D. Title and body below are what goes on
GitHub.

---

**Title:** Add freeze control and feedback (sources, screens, auxes, layers)

**Body:**

Generated with Claude Code; Claude writes better JavaScript than I do. Tested against actual hardware.

#### **Actions**

- **Freeze Source (Toggle)**: Freeze, unfreeze or toggle an input source
- **Freeze Screen Destination (Toggle)**: Freeze, unfreeze or toggle all outputs of a screen destination
- **Freeze Aux Destination (Toggle)**: Freeze, unfreeze or toggle an AUX destination
- **Freeze Layer (Toggle)**: Freeze, unfreeze or toggle a layer on PGM or PVW (`changeContent`
  `Layers[].Freeze`)
- Toggle uses the freeze state reported by the EventMaster, so it is correct after a freeze from EM
  Toolset or the console

#### **Feedbacks**

- **Source Frozen**, **Aux Destination Frozen**
- **Screen Destination Frozen**: Any or all outputs
- **Layer Frozen**: PGM or PVW

#### **Variables**

- `source_N_frozen`, `screen_N_frozen` (Yes/Partial/No), `aux_N_frozen`
- `screen_S_layer_N_pgm_frozen`, `screen_S_layer_N_pvw_frozen`
- `source_N_label`, `screen_N_label`, `aux_N_label`: Name without the `-N` the EventMaster appends

#### **Presets**

- _Freeze Sources_ (live inputs only), _Freeze Screen Destinations_, _Freeze Aux Destinations_,
  _Freeze Layers_ (PGM and PVW per layer)
- _Freeze_ above the name; blue, _FROZEN_ while frozen

#### **State**

- **Source**: `listSources` `Freeze`
- **Screen**: `listDestinations` per output; `DestOutMapCol`/`FrzMode` (9.2), with
  `DestOutMapColl`/`Freeze` (Barco 8.2 JSON-RPC document) as fallback
- **AUX**: `listDestinations` `FrzMode`
- **Layer**: `listContent`, kept from the existing source monitoring pass. Layers grouped by Z order:
  an A/B mixing pair shares one, a single layer has its own (names differ by model: E2 `Layer1-A`,
  PDS-4K `LayerA`). PGM/PVW resolved at press time; the freeze stays with the physical layer through a
  transition. A single or split layer is on both buses and shows the same state on both
- **Refresh**: Immediate re-read after a freeze from Companion; otherwise the polling interval. No
  dependency on live updates

#### **PDS-4K**

- Input and output freeze are accepted and read back, but the output is not frozen
- Not offered on PDS-4K (`FrameType` 6): source and destination freeze actions, feedbacks, presets
  and variables, including the existing _Freeze/Unfreeze Source_ and _Freeze/Unfreeze Destination_
- **Breaking**: Existing PDS-4K buttons using those two actions show as missing actions (they never
  froze the output)
- Layer freeze is offered (same as the front panel freeze button)
- Evidence, 9.2.5963, moving source on a PGM layer, output on a monitor, 20 s each, master unchanged:

| Action                                               | Read-back   | Output |
| ---------------------------------------------------- | ----------- | ------ |
| _Freeze/Unfreeze Source_ (`freezeDestSource` type 0) | `Freeze 1`  | Live   |
| _Freeze/Unfreeze Destination_ (type 2)               | `FrzMode 1` | Live   |
| Layer freeze (`changeContent` `Layers[].Freeze`)     | `Freeze 1`  | Frozen |

#### **Tested**

- **E2, 9.2.6373**, output on a monitor: source, screen, AUX, layer and native background freeze;
  layer frozen on PVW then transitioned
- **PDS-4K, 9.2.5963**, output on a monitor: layer freeze, including split layers
- **This branch**, both frames, polling only: every toggle confirmed by read-back

#### **Compatibility**

- New actions, feedbacks, presets and variables only; no existing options change, no upgrade script
- Other models unchanged
