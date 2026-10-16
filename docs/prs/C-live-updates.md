# PR C: live updates

Branch `feature/live-updates-rework` (worktree `../pr-c-live-updates`), from upstream master `9f84de7`.
Commit `44d04b6`. Standalone. Conflicts with PR B in `autoPopulateSourceMonitoring` (both touch the
content read); whichever merges second needs a rebase. Title and body below are what goes on GitHub.

---

**Title:** Fix live updates setup and teardown; follow more changes, heartbeat instead of polling

**Body:**

Generated with Claude Code; Claude writes better JavaScript than I do. Tested against actual hardware.

#### **Fixes**

Each reproduced on master (`9f84de7`, unchanged) against an E2 (9.2.6373) and a PDS-4K (9.2.5963),
then rerun on this branch. Windows, Companion's node18.

| Issue                                                                                                                                     | Master                                                                                                                                                                                         | This branch                                                                                                                          |
| ----------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| "Unsubscribe to start clean" is `unsubscribe(callback)`: the callback lands in the hostname slot                                          | Sends `unsubscribe {}`; the frame replies JSON-RPC error -32603 (E2 `Cannot call method 'forEach' of undefined`, PDS-4K `Cannot read property 'indexOf' of undefined`), dropped by the library | Call removed; teardown unsubscribes the host, port and events it subscribed                                                          |
| Teardown never stops the notification server                                                                                              | Config save: second server `EADDRINUSE`, silently; the leaked first server keeps delivering. Port change: old port still answers HTTP 200                                                      | Server stopped on teardown; same-port re-setup listens and receives; old port refused after a port change                            |
| Listen errors are swallowed: Express 5 passes the error to the `app.listen` callback, and `barco-eventmaster` logs "listening" regardless | Port held by another process: module status OK, no error, notifications go to the other process                                                                                                | `live_updates_status` and the log: `port 3006 is already in use on this machine - choose another notification port`; full poll stays |
| Teardown port fallback `3004`, setup `3000`                                                                                               | Unsubscribe to the wrong port when `notification_port` is empty                                                                                                                                | One port                                                                                                                             |

Not fixed: a subscription left by an earlier run on a **different** host or port (e.g. the module
killed without teardown, then reconfigured) keeps receiving until the frame restarts; the
module can't know old ports. On master the "clean start" doesn't clear it either.

Checked and not a bug: the frame accepts the port as a number or a string.

#### **Live Updates**

- **Events**: screen, AUX, input, output, source, preset, cue, still, frame and background changes
  (master: screen and AUX). `NativeRateChanged` is left out: the PDS-4K rejects the whole subscribe if
  it is listed (`"NativeRateChanged is not applicable for PDS."`)
- **Targeted reads**: Notifications carry ids only; each debounced batch (500 ms) re-reads just what
  changed. A take streams one `ScreenDestChanged` per video frame of the transition: one read once it settles.
  `OutputCfgChanged` carries output ids, mapped to the owning screen or AUX; an id that can't be
  placed re-reads everything. Additions, removals and renames refresh everything
- **Heartbeat**: While subscribed, the full poll is replaced by one `powerStatus` call every 15 s and
  a full refresh every 5 min (for anything not notified, e.g. user keys). Polling interval 0 turns
  both off
- **Restart**: Subscriptions are lost when the frame restarts; the heartbeat detects it going
  away (logged once) and coming back, then re-subscribes and refreshes. Also re-subscribes every 10 min
- **Fallback**: Subscribe refused or listener error: full poll restored
- **Status Variables**: `live_updates_status` (Off, Subscribed, Subscribe failed with the
  frame's reason, Error), `live_updates_last`, `live_updates_listener`
- **Listener Address**: Auto-detected from the interface on the frame's network (real netmask;
  wired before Wi-Fi; VPN and virtual adapters last), shown under the host field. A typed address
  still wins
- **Power Status**: A frame without a usable `powerStatus` reply is warned once, not on every poll

#### **Config**

- _Polling interval (seconds, 0 = off)_
- _Notification port (this machine)_
- _Notification server host (leave blank to auto-detect)_, with the detected address below it

#### **Tested**

- **Fixes**: Master and this branch against both frames (table above), with transcripts of every
  JSON-RPC request and reply, each notification and which server received it
- **Live updates on hardware**: The same live-updates code in a fork build, against both frames:
  subscribe, notifications and targeted reads for freeze, takes, arm, test patterns and AUX changes,
  heartbeat, and an E2 restart with re-subscribe
- **This branch**: Subscribe, targeted reads, take bursts, heartbeat, restart and re-subscribe,
  fallback, port in use and listener address selection against a mock Event Master frame

#### **Compatibility**

- No action, feedback or preset changes. New variables only; config labels reworded, ids unchanged
- Live updates stay opt-in (_Enable live updates_)
