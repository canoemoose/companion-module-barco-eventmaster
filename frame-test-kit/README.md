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

## Files

- `Run-FrameTests.ps1`: entry point (Windows checks, then runs the kit)
- `kit.js`: the guided test (Node 18, no dependencies)
- `mock-frame.js`: mock frame for rehearsal (options are listed at the top of the file)
- `FRAME-PREP.md`: minimum programming for a blank frame
