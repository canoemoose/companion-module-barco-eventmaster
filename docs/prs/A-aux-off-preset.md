# PR A: aux test pattern Off preset

Branch `fix/aux-test-pattern-off-preset` (worktree `../pr-a-aux-off-preset`), from upstream master
`9f84de7`. Commits `35ee421`, `0ec94e4`. Title and body below are what goes on GitHub.

---

**Title:** Fix the aux test pattern Off preset

**Body:**

Generated with Claude Code; Claude writes better JavaScript than I do.
Tested against actual hardware.

The _Off_ button in each _Test patterns for <aux>_ preset category doesn't turn the test pattern off.

The preset sets `screenDestination`, but `testpattern_on_AUX` reads `auxDestination`, so the action
sends `id: null` and the EventMaster rejects it. The other 20 aux test pattern presets already use
`auxDestination`; only Off had the screen option.

Tested on an E2, firmware 9.2.6373, with the aux on a monitor: colour bars on the aux, then the Off
preset as shipped:

```
-> changeAuxContent {"id":null,"TestPattern":0}
<- changeAuxContent {"success":-1,"response":"Aux dest. id = null Not Found"}
```

The bars stayed on the output, and the aux still read `TestPatternMode 3` 20 s later. With
`auxDestination` set, the same action sends `{"id":0,"TestPattern":0}`, gets `success 0`, and the bars
go off.

Changes:

- `presets.js`: the aux Off preset uses `auxDestination`
- `upgrades.js`: an upgrade script moves `screenDestination` to `auxDestination` on existing
  `testpattern_on_AUX` actions that don't have one, so buttons already made from the old preset are
  fixed too. Screen test pattern actions are left alone
- `eventmaster.js`: passes `upgrades.js` to `runEntrypoint` (it was an empty array before)

No other presets, actions or variables change.
