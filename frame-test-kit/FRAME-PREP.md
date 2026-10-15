# Frame prep (blank frame, about 5 minutes in EMT)

The minimum show the test steps need. The kit's readiness check confirms each item and skips any
step whose prerequisite is missing, so a gap costs a step, not the session.

Best done **during the kit's Prep phase**: the listener is already on, so programming the frame also
tests the network path (a screen or preset change should produce a notification).

| #   | What                                                                                                               | Why                                                  | Required                        |
| --- | ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------- | ------------------------------- |
| 1   | **Sources from 2 inputs**, ideally with real signal (laptop, test generator). Keep the auto-generated names.       | Freeze, layer and tally steps; the `-N` naming check | Yes (1 will do)                 |
| 2   | **1 screen destination** with an output assigned                                                                   | Screen freeze, takes, control steps                  | Yes                             |
| 3   | **2 layers** on that screen, a different source on each                                                            | Layer-source change step                             | 1 will do                       |
| 4   | **1 aux destination** with an output assigned                                                                      | Aux source and freeze steps, `AUXDestChanged`        | Yes                             |
| 5   | **2 presets** on the screen with different layer sources (set it up, save Preset 1; change a layer, save Preset 2) | Recall step                                          | 1 will do                       |
| 6   | Screen destination added back as a source (re-entry)                                                               | Re-checks the module's `DestIndex` filter            | Optional, skip if short of time |
| 7   | A still                                                                                                            | Still step                                           | Optional, skip                  |

Write down whether the inputs had signal: freeze and tally behaviour without signal is unverified.

Before Phase A, put screen and aux back to a neutral state: nothing frozen.
