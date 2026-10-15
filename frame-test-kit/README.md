# Event Master frame test kit

Finds out what an Event Master frame tells a client when things change: JSON-RPC notifications,
anything pushed on the XML port 9876, and EMT's own traffic. **The kit changes nothing on the frame.**
It only subscribes, unsubscribes and reads. You make every change in EMT when it asks.

Defaults: frame `192.168.0.175`, this laptop `192.168.0.100`, notification port `3000`.
Runs on Companion's own Node (`C:\Program Files\Companion\resources\node-runtimes\node18`), so there's
nothing to install.

## Before site: rehearse (2 minutes)

```
powershell -ExecutionPolicy Bypass -File .\Run-FrameTests.ps1 -Rehearsal
```

Runs everything against a mock frame. Press Enter at each prompt and the mock does the step. Expect
the control steps A1, A18 and A19 to pass and the freeze/take steps to show 9876 bytes.

## On site

1. **Disable the Event Master connection in Companion** (it holds port 3000).
2. Open an **admin** PowerShell in this folder (admin is needed to set the network profile and for
   the Phase C capture), then run:
   ```
   powershell -ExecutionPolicy Bypass -File .\Run-FrameTests.ps1
   ```
3. Follow the prompts. At each step: Enter = done, `s` = skip, `q` = stop the phase. Ctrl+C at any
   point still unsubscribes and writes results.

| Phase              | What happens                                                                                                         | Time       |
| ------------------ | -------------------------------------------------------------------------------------------------------------------- | ---------- |
| Windows checks     | node found, interface on the frame's subnet, network profile (offers to set Private), firewall rule, port 3000 free  | 30 s       |
| Identification     | Model, firmware, MAC, counts. Names the results folder                                                               | 5 s        |
| Preflight          | JSON 9999 answers, 9876 connects, port free                                                                          | 5 s        |
| Prep               | Listener on while you program the frame per [FRAME-PREP.md](FRAME-PREP.md). Enter straight away if it's already done | 5 min      |
| Naming / readiness | `-N` name suffixes, re-entry filter, what's missing for the steps                                                    | 5 s        |
| A                  | 19 steps in EMT. After each: notifications received, 9876 bytes, and what changed in the frame's state               | 6 to 8 min |
| C                  | pktmon capture of EMT's traffic while another client freezes and takes. Needs admin and EMT on this laptop           | 3 min      |

**A1 is the canary.** It renames the screen and expects `ScreenDestChanged`. If that doesn't arrive,
the frame can't reach the laptop: the kit stops and says why. Fix (profile Private, firewall, IP) and
rerun with `-Phases A`.

Phase C asks you to freeze and take from a **different** client (Companion, a second EMT, or the front
panel) while EMT runs here. Re-enable the Companion connection for that if you're using it. Inbound
traffic to this EMT is then unsolicited push. It also asks you to save EMT's Ctrl+O XML log into the
results folder.

## Reruns

```
.\Run-FrameTests.ps1 -Phases A                 # Phase A again (with the identification it needs)
.\Run-FrameTests.ps1 -Phases A -Steps A2,A3    # just these steps
.\Run-FrameTests.ps1 -Phases C                 # just the EMT capture
.\Run-FrameTests.ps1 -FrameIp 10.0.0.5 -LocalIp 10.0.0.20 -Settle 5
```

Each run writes a new folder, so nothing is overwritten.

## Send back

The whole results folder: `results\<model>_<firmware>_<time>\`. It contains `results.md` (the summary
and the action x notification matrix), raw logs (`notifications.jsonl`, `xml-9876.log`), a state
snapshot per step (`snapshots\`), `frame-settings.json`, and from Phase C `emt-capture.pcapng` plus
the EMT XML log you saved.

## Module check on another frame (e.g. a PDS-4K)

`module-check.js` runs this repo's module code against a frame and reports whether it answers back
sensibly: model and firmware, the field shapes the module relies on (freeze, arm, signal, test
pattern), what the module makes of it, whether live updates subscribe, and whether the heartbeat
works. About 30 seconds. Run it from the repo checkout (it uses the repo's module and
`node_modules`), with Companion's node18 so the existing firewall rule applies. It listens on port
3005, so a running Companion on 3000 is unaffected.

1. Read-only first:
   ```
   & "C:\Program Files\Companion\resources\node-runtimes\node18\node.exe" frame-test-kit\module-check.js --frame <PDS IP>
   ```
2. If that looks sane and the frame can be touched, add `--changes`. It freezes and unfreezes the
   first live source and screen 0, arms and unarms screen 0, and puts test pattern bars on screen 0
   and takes them off, each from a second client. It also freezes and unfreezes an aux, if the frame
   has one. Each change is only made if that thing starts neutral (unfrozen, unarmed, no pattern),
   and everything is put back, even after an error. **Screen 0's output shows bars and a freeze for
   a second or two each.**
   ```
   & "C:\Program Files\Companion\resources\node-runtimes\node18\node.exe" frame-test-kit\module-check.js --frame <PDS IP> --changes
   ```

On the PDS-4K expect: no aux destinations (aux steps skipped), and possibly no `powerStatus` (one
warning, heartbeat still works). Anything marked FAIL is worth sending back. The report is saved as
`results\module-check_<model>_<firmware>_<time>.txt`, with the raw frame settings beside it.

Rehearse without a frame: `node frame-test-kit\mock-frame.js --pds` in one window, then
`module-check.js --frame 127.0.0.1 --local 127.0.0.1 --changes` in another.

## Files

- `Run-FrameTests.ps1`: entry point (Windows checks, then runs the kit)
- `kit.js`: the guided test (Node 18, no dependencies)
- `module-check.js`: the module code against a real frame (see above)
- `mock-frame.js`: mock frame for rehearsal (options are listed at the top of the file)
- `FRAME-PREP.md`: minimum programming for a blank frame
