## Barco EventMaster

This module uses the official EventMaster JSON API.  
**Note:** The JSON API is not available in the simulator; you must use a real EventMaster device or the official virtual box simulator.  
If the status is OK, it ONLY means that the configured IP responds to ICMP ping.

The module will update presets and actions every 15 seconds by default (configurable in module settings).

---

### **Configuration Options**

- **Target IP**: IP address of the EventMaster device
- **Polling Interval**: How often to refresh data (in seconds, 0 to disable)
- **Authentication Mode**: None, Operator ID, or Super User Password
- **Auth Value**: Authentication credentials (when required)
- **Enable Live Updates**: Let the frame notify Companion of changes (freeze, takes, names, presets)
- **Notification Server Port**: Local port for receiving EventMaster notifications (default: 3000)
- **Notification Listener IP**: IP address the EventMaster should send notifications to (auto-detected on the frame's subnet if empty)

---

### **Live Updates (EventMaster Subscriptions)**

With live updates on, the frame notifies Companion when something changes, from anywhere (Companion, EM Toolset or the console), and the module re-reads only what changed. On firmware 9.2 this covers source, screen and aux freeze, takes and recalls (tally), screen arm, test patterns, input signal, renames and preset changes. Feedback follows within about half a second. Nothing is polled beyond the normal polling interval.

Without live updates, changes made outside Companion show at the next polling interval.

#### **Status variables**

- `live_updates_status`: Off, Subscribed, Subscribe failed (with the frame's reason), or Error (e.g. port already in use)
- `live_updates_last`: time and type of the last notification received

#### **Network Requirements**

- The frame connects **to** Companion, so the notification port must accept inbound TCP from the frame's IP (Windows: check the network profile is Private and the port is allowed inbound)
- Subscriptions are lost when the frame restarts; the module re-subscribes every 10 minutes, so after a frame reboot live updates resume within 10 minutes (or disable and re-enable the connection to resume at once)

---

### **Available Actions**

#### **Presets**

- **Recall Preset**: Load a preset to Preview or Program
- **Recall Next Preset**: Automatically recall the next available preset
- **Save Preset**: Save current state as a new preset
- **Delete Preset**: Remove an existing preset
- **Rename Preset**: Change the name of an existing preset

#### **Transport Controls**

- **Cut Active**: Instantly switch preview to program
- **Take/Trans Active**: Transition preview to program with fade

#### **Cues**

- **Play Cue**: Start playing a cue
- **Stop Cue**: Stop a playing cue
- **Pause Cue**: Pause a playing cue

#### **Sources & Destinations**

- **Freeze/Unfreeze Source**: Freeze or unfreeze video sources
- **Freeze/Unfreeze Destination**: Freeze or unfreeze destination outputs
- **Arm/Unarm Destination**: Arm, unarm or toggle a screen destination for transitions (toggle uses the armed state the frame reports; the _Arm/Unarm Destinations_ presets include a single toggle button that reads ARMED while armed). Aux arm has no toggle: the frame does not report whether an aux is armed
- **Freeze Source (Toggle)**: Toggle, freeze or unfreeze an input source using the freeze state reported by the frame
- **Freeze Screen Destination (Toggle)**: Toggle, freeze or unfreeze a screen destination (toggle unfreezes if any output is frozen)
- **Freeze Aux Destination (Toggle)**: Toggle, freeze or unfreeze an aux destination

#### **Freeze Feedback**

- **Source Frozen**: Button lights when the selected source is frozen, whoever froze it (Companion, EM Toolset or the console)
- **Screen Destination Frozen**: Button lights when any (or all) outputs of the screen destination are frozen
- **Aux Destination Frozen**: Button lights when the aux destination is frozen
- Variables: `source_N_frozen` (Yes/No), `screen_N_frozen` (Yes/Partial/No), `aux_N_frozen` (Yes/No), and `source_N_label` / `screen_N_label` / `aux_N_label` (name with the frame-appended `-N` source/input number removed, e.g. `Cam 1-1` → `Cam 1`)
- Freeze presets and dropdowns list live inputs only (stills, and destinations or user keys re-entered as sources, are left out)
- Presets: _Freeze Sources_, _Freeze Screen Destinations_ and _Freeze Aux Destinations_ categories contain ready-made toggle buttons: they read _Freeze_ above the source name, and turn blue reading _FROZEN_ while frozen
- Freeze made from Companion shows immediately; changes made elsewhere show within about half a second with live updates on, otherwise at the next polling interval

#### **Arm, Signal and Test Pattern Feedback**

- **Screen Destination Armed**: Button lights when the screen destination is armed (selected for transitions). The _Arm/Unarm Destinations_ Arm preset reads _ARMED_ while armed. Aux arm isn't reported by the frame, so there is no aux armed feedback
- **Source Signal**: Button lights when an input's signal matches the chosen condition: any problem (the default: no signal, format mismatch, out of range or invalid), signal OK, or one specific condition. Stack two on a button for, say, green when OK and red when lost. `source_N_signal` shows the state as text
- **Test Pattern Active**: Button lights when a test pattern is on a screen or aux destination: any pattern, or a chosen one. The _Test patterns_ presets show _ON_ on the active pattern, and on _Off_ while no pattern is on
- Variables: `screen_N_armed` (Yes/No), `source_N_signal` (OK, No signal, Format mismatch, Out of range, Invalid), `screen_N_test_pattern` / `aux_N_test_pattern` (pattern name, or Off)

#### **AUX Destinations**

- **Set testpattern for AUX**: Apply test patterns to AUX outputs (legacy)
- **Change AUX Content**: Enhanced AUX control with multiple options:
  - Set preview/program sources independently
  - Change AUX destination name
  - Apply test patterns
  - All parameters optional - only change what you specify

#### **Screen Destinations**

- **Set testpattern for screen destinations**: Apply test patterns to screen outputs (legacy)
- **Change Screen Content**: Comprehensive screen destination control:
  - **Test Patterns**: Apply various test patterns
  - **Background Control**: Set program/preview background sources with matte options
  - **Layer Management**: Configure individual layers with source, mode, and positioning
  - **Window Control**: Position and resize layer windows with pixel precision
  - All parameters optional for selective updates

#### **Layers**

- **Fit Layers to Screen Destination**: Auto-fit specified layers to fill screen
- **Clear Layers from Screen Destination**: Remove content from specified layers

#### **User Keys**

- **Recall User Key**: Activate user-defined key macros with layer targeting

#### **Groups**

- **Activate Destination Group**: Enable destination groups by ID or name

#### **Source Backup System**

- **List Source Main Backup**: Show backup configurations for inputs/backgrounds
- **Activate Source Main Backup**: Configure up to 3 backup sources per input:
  - Set backup sources (inputs or stills)
  - Choose active backup state (primary, backup 1, 2, or 3)
  - Automatic failover support
- **Reset Source Main Backup**: Reset source backup to primary

#### **MVR (Multi-Viewer)**

- **Activate MVR Preset**: Load MVR preset by ID
- **Change MVR Layout**: Switch multi-viewer layouts with frame unit control

#### **System & Diagnostics**

- **Reset Frame Settings**: Various reset options (soft, factory, power down)
- **Get Power Status**: Check power supply status and update variables
- **Get Frame Settings**: Retrieve system information and update variables

---

### **Usage Examples**

#### **Basic Operation**

1. **Preset Recall**: Select preset and mode (Preview/Program) to load content
2. **Source Switching**: Use "Change AUX Content" or "Change Screen Content" for flexible source routing
3. **Transitions**: Use "Take/Trans Active" for smooth transitions or "Cut Active" for instant switching

#### **Advanced Layer Control**

1. **Layer Positioning**: Use "Change Screen Content" with window H/V position and size controls
2. **Layer Sources**: Set different sources per layer with preview/program mode selection
3. **Background Management**: Independent control of program and preview backgrounds

#### **Backup Configuration**

1. **Setup Backups**: Use "Activate Source Main Backup" to configure backup sources
2. **Monitor Status**: Use "List Source Main Backup" to check current backup configurations
3. **Manual Switching**: Use backup state selection to manually switch between sources

#### **Source Monitoring**

1. **Automatic Monitoring**: Source variables are automatically populated on startup and updated during polling
   - Each source shows which destinations it's active on (PGM and PVW)
   - Variables update in real-time based on your polling interval
   - Get instant overview of source usage across all destinations
2. **Manual Refresh**: Use "Refresh Source Monitoring" action for immediate updates of all sources
   - Perfect for confirming current source distribution
   - Individual destination actions also refresh source monitoring
   - Ideal for live production monitoring and troubleshooting

#### **Test Patterns**

- Simple test patterns: Use legacy "Set testpattern" actions
- Advanced patterns: Use "Change AUX/Screen Content" for pattern + source combinations

---

### **Available Variables**

#### **System Information**

- `$(barco-eventmaster:frame_IP)`: EventMaster IP address
- `$(barco-eventmaster:frame_version)`: Software version
- `$(barco-eventmaster:frame_OSVersion)`: Operating system version
- `$(barco-eventmaster:power_status1)`: Power supply 1 status
- `$(barco-eventmaster:power_status2)`: Power supply 2 status

#### **Hardware Status**

- `$(barco-eventmaster:cardX_info)`: Card slot X information (X = 1-20)
  - Displays card type, status, and temperature/fan status
- `$(barco-eventmaster:syscard_info)`: System card information

#### **Source Monitoring** _(Auto-populated on startup and polling)_

- `$(barco-eventmaster:source_X_pgm_destinations)`: Which destinations source X is active on PGM
- `$(barco-eventmaster:source_X_pvw_destinations)`: Which destinations source X is active on PVW

_Examples:_

- `$(barco-eventmaster:source_1_pgm_destinations)` = "Screen Main, AUX 2"
- `$(barco-eventmaster:source_5_pgm_destinations)` = "Not active on PGM"

_Note: Source monitoring variables are automatically populated during startup and updated via polling. You can also manually refresh them using the "Refresh Source Monitoring" action_

---

### **Available Feedback (Source Tally)**

The module provides two types of source tally feedback for buttons:

#### **Source Active (Simple)**

- **Purpose**: Basic tally feedback - shows if a source is active anywhere
- **Colors**:
  - **Red**: Source is active on Program (PGM) on any destination
  - **Green**: Source is active on Preview (PVW) on any destination
  - **No Color**: Source is not active anywhere
- **Use Case**: Quick overview of source activity across your entire system
- **Configuration**: Just select the source number

#### **Source Active on Destinations**

- **Purpose**: Advanced tally feedback - shows if a source is active on specific destinations
- **Colors**:
  - **Red**: Source is active on Program (PGM) on the selected destination(s)
  - **Green**: Source is active on Preview (PVW) on the selected destination(s)
  - **No Color**: Source is not active on the selected destination(s)
- **Destination Options**:
  - **Anywhere**: Monitor all destinations (same as Simple feedback)
  - **Anywhere PGM**: Monitor all destinations for PGM activity only
  - **Anywhere PVW**: Monitor all destinations for PVW activity only
  - **Specific Screens**: Monitor individual screen destinations (LED MAIN PGM, LED SIDES PVW, etc.)
  - **Specific AUX**: Monitor individual AUX destinations (WAL 1 PGM, WAL 2 PVW, etc.)
- **Tally State Options**:
  - **Program**: Only show feedback when source is on PGM
  - **Preview**: Only show feedback when source is on PVW
- **Use Case**: Precise monitoring of source usage on specific outputs

#### **Real-time Updates**

- Both feedback types update within about half a second with **Live Updates** on, otherwise on the main polling interval
- Changes made anywhere (Companion, EM Toolset, console) are picked up within one polling interval
- Works with background layers, regular layers, and AUX content

#### **Usage Examples**

1. **Master Tally Wall**: Use "Source Active (Simple)" for an overview of all source activity
2. **Operator Panel**: Use "Source Active on Destinations" to monitor specific screen or AUX outputs
3. **Director Panel**: Use destination-specific feedback to see what's live on main program feeds
4. **Technical Monitoring**: Use both types - simple for overview, specific for detailed monitoring

---

### **Available Presets**

Dynamic presets are generated based on your EventMaster configuration:

- **Presets**: Recall, Save, Delete, Rename operations
- **Cues**: Play, Stop, Pause controls
- **Transport**: Auto Trans/Cut buttons
- **User Keys**: Quick access to configured user keys
- **Layers**: Fit/Clear layer operations
- **MVR**: Multi-viewer preset and layout controls

---

### **Tips & Best Practices**

1. **Polling**: Set appropriate polling interval based on your network and performance needs
2. **Authentication**: Use Super User mode for full access, Operator ID for restricted access
3. **Backup Sources**: Configure backup sources for critical inputs to ensure show continuity
4. **Layer Management**: Use "Change Screen Content" for precise layer control vs. simple "Fit/Clear" operations
5. **Test Patterns**: Use enhanced content actions for combining test patterns with source routing

---

For detailed option descriptions and parameter ranges, see the action configuration dialogs in Companion.
