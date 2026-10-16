# PR D: arm, signal and test pattern feedback

Branch `feature/status-feedback` (worktree `../pr-d-status-feedback`), **on top of PR C**
(`feature/live-updates-rework`). Commit `c98e035`. Open after PR C, or as a PR whose base is PR C's
branch; its diff against master includes PR C until that merges. Title and body below are what goes on
GitHub.

---

**Title:** Add arm, input signal and test pattern feedback

**Body:**

Generated with Claude Code; Claude writes better JavaScript than I do. Tested against actual hardware.

Depends on #NNN (PR C: replace NNN with its number once open): state comes from its content cache and follows changes made elsewhere through its
notifications.

#### **Feedbacks**

- **Screen Destination Armed**: Screen destination is armed for transitions (`listContent` `IsActive`)
- **Source Signal**: Input signal problem (no signal, format mismatch, out of range, invalid), signal
  OK, or one specific condition (`listSources` `InputCfgVideoStatus`)
- **Test Pattern Active**: Any, or a specific, test pattern on a screen or AUX destination
  (`listContent` / `listAuxContent` `TestPatternMode`)

#### **Actions**

- **Arm/Unarm Destination**: Adds Toggle, from the armed state reported by the frame. AUX arm has no
  toggle: the frame doesn't report it
- Arm and test pattern actions re-read their destination afterwards, so the feedback follows straight
  away

#### **Variables**

- `screen_N_armed` (Yes/No)
- `source_N_signal` (OK, No signal, Format mismatch, Out of range, Invalid), live inputs only
- `screen_N_test_pattern`, `aux_N_test_pattern` (pattern name, or Off)

#### **Presets**

- _Arm/Unarm Destinations_: the Arm preset reads _ARMED_ while armed; a single Arm toggle preset is
  added
- _Test patterns_: the active pattern's button turns yellow round its icon (background only; the
  icons are 72x58). The Off buttons have no feedback: their icon is transparent

#### **Tested**

- **E2, 9.2.6373** and **PDS-4K, 9.2.5963**, live updates on: arm toggle through the action, state
  confirmed after the frame's notifications settle; test pattern on and off through the action,
  variable and feedback follow; signal variables for every live input
- Test pattern changes made from another JSON-RPC client followed through notifications (fork build
  with the same code, both frames); arm and signal from another client in the fork's tests

#### **Compatibility**

- New feedbacks, variables and one preset. The Arm preset and 40 test pattern presets gain a feedback;
  existing buttons made from them keep working but don't light up (an upgrade script can't add a
  feedback): add the preset again to get it
- Arm/Unarm Destination gains a choice; existing options unchanged
