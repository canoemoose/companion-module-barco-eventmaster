const Module = require('module'),
	http = require('http'),
	path = require('path'),
	os = require('os'),
	net = require('net')
const MOD = require('path').resolve(__dirname, '..')
let Captured
const origLoad = Module._load
Module._load = function (req) {
	if (req === '@companion-module/base') {
		class InstanceBase {
			constructor() {
				this.vars = {}
				this.logs = []
			}
			log(l, m) {
				this.logs.push([l, m])
			}
			setVariableValues(v) {
				Object.assign(this.vars, v)
			}
			setVariableDefinitions(d) {
				this.varDefs = d
			}
			checkFeedbacks() {}
			getVariableValue(k) {
				return this.vars[k]
			}
			setActionDefinitions(a) {
				this.actions = a
			}
			setFeedbackDefinitions(f) {
				this.feedbacks = f
			}
			setPresetDefinitions(p) {
				this.presets = p
			}
			updateStatus() {}
		}
		return {
			InstanceBase,
			InstanceStatus: {},
			Regex: {},
			runEntrypoint: (c) => (Captured = c),
			combineRgb: (r, g, b) => (r << 16) + (g << 8) + b,
		}
	}
	return origLoad.apply(this, arguments)
}

const frame = {
	up: true,
	subscribeSuccess: 0,
	calls: [],
	subs: [],
	sources: [
		{ id: 0, Name: 'Cam 1-1', InputCfgIndex: 0, DestIndex: -1, UserKeyIndex: -1, Freeze: 0, InputCfgVideoStatus: 1 },
		{ id: 1, Name: 'Cam 2-2', InputCfgIndex: 1, DestIndex: -1, UserKeyIndex: -1, Freeze: 0, InputCfgVideoStatus: 1 },
	],
	// Shapes as returned by 9.2.6318: DestOutMapCol is an object, screen and aux freeze is FrzMode
	screens: [
		{ id: 0, Name: 'LED MAIN', DestOutMapCol: { DestOutMap: [{ id: 0, FrzMode: 0 }] } },
		{ id: 1, Name: 'IMAG', DestOutMapCol: { DestOutMap: [{ id: 0, FrzMode: 0 }] } },
	],
	auxes: [{ id: 0, Name: 'Aux 1', AuxStreamMode: 1, FrzMode: 0 }],
	// Output ids are frame-wide (screen 0 owns output 0, aux 0 output 1, screen 1 output 2), as on the E2
	content: { 0: { pgmSrc: -1, armed: 0, out: 0, tp: 0 }, 1: { pgmSrc: -1, armed: 0, out: 2, tp: 0 } },
	aux: { 0: { pgmSrc: -1, out: 1, tp: 0 } },
}
const server = http.createServer((req, res) => {
	let body = ''
	req.on('data', (c) => (body += c))
	req.on('end', () => {
		if (!frame.up) {
			res.statusCode = 503
			return res.end('down')
		}
		const { method, params } = JSON.parse(body)
		frame.calls.push({ method, params, t: Date.now() })
		let response = null,
			success = 0
		if (method === 'listSources') response = frame.sources
		else if (method === 'listDestinations') response = { ScreenDestination: frame.screens, AuxDestination: frame.auxes }
		else if (method === 'listContent')
			response = {
				id: params.id,
				IsActive: frame.content[params.id].armed,
				BGLyr: [],
				Layers: [{ id: 0, LastSrcIdx: frame.content[params.id].pgmSrc, PgmMode: 1, PvwMode: 0, Freeze: 0 }],
				OutputCfg: [
					{
						id: frame.content[params.id].out,
						Name: 'Out',
						OutputAOI: [{ id: 0, TestPattern: [{ id: 0, TestPatternMode: frame.content[params.id].tp }] }],
					},
				],
			}
		else if (method === 'armUnarmDestination') {
			for (const d of params.ScreenDestination || []) frame.content[d.id].armed = params.arm
		} else if (method === 'listAuxContent')
			response = {
				id: params.id,
				PgmLastSrcIndex: frame.aux[params.id].pgmSrc,
				PvwLastSrcIndex: -1,
				OutputCfg: [
					{
						id: frame.aux[params.id].out,
						Name: 'Out',
						OutputAOI: [{ id: 0, TestPattern: [{ id: 0, TestPatternMode: frame.aux[params.id].tp }] }],
					},
				],
			}
		else if (method === 'subscribe') {
			success = frame.subscribeSuccess
			frame.subs.push(params)
		} else if (method === 'unsubscribe') {
			frame.subs = frame.subs.filter((s) => !(s.hostname === params.hostname && s.port === params.port))
		} else if (method === 'listPresets' || method === 'listCues' || method === 'listUserKeys') response = []
		else if (method === 'powerStatus') response = { 0: { PowerSupply1Status: 1, PowerSupply2Status: 1 } }
		res.setHeader('content-type', 'application/json')
		res.end(JSON.stringify({ jsonrpc: '2.0', id: '0', result: { success, response } }))
	})
})
// Frame pushing a notification to the subscriber
const notify = (type, update = [0], add = []) => {
	const s = frame.subs[frame.subs.length - 1]
	const data = JSON.stringify({
		result: { method: 'notification', notificationType: type, change: { add, remove: [], update } },
	})
	return new Promise((r) => {
		const req = http.request(
			{
				host: '127.0.0.1',
				port: Number(s.port),
				method: 'POST',
				path: '/',
				headers: { 'content-type': 'application/json' },
			},
			(res) => {
				res.resume()
				res.on('end', r)
			},
		)
		req.on('error', r)
		req.end(data)
	})
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const until = async (fn, ms = 4000) => {
	const t = Date.now()
	while (Date.now() - t < ms) {
		if (fn()) return true
		await wait(50)
	}
	return false
}
let fails = 0
const check = (l, c) => {
	console.log(`${c ? 'PASS' : 'FAIL'}  ${l}`)
	if (!c) fails++
}
const portFree = (p) =>
	new Promise((r) => {
		const s = net
			.createServer()
			.once('error', () => r(false))
			.once('listening', () => s.close(() => r(true)))
			.listen(p)
	})

server.listen(9999, '127.0.0.1', async () => {
	require(path.join(MOD, 'eventmaster.js'))
	const EventMaster = require(path.join(MOD, 'node_modules/barco-eventmaster'))
	const mk = (cfg) => {
		const inst = new Captured({})
		inst.config = { host: '127.0.0.1', ...cfg }
		inst.previousVariableValues = {}
		inst.frameVariableDefinitions = []
		inst.CHOICES_TESTPATTERN = [
			{ label: 'Off', id: '0' },
			{ label: '100% Color Bars', id: '3' },
		]
		inst.CHOICES_FREEZE = []
		inst.eventmasterData = {
			presets: {},
			sources: {},
			cues: {},
			userKeys: {},
			AuxDestinations: {},
			ScreenDestinations: {},
			SuperDestinations: {},
			SuperAuxDestinations: {},
		}
		inst.getFrameSettings = async () => {}
		inst.getPowerStatusFromEventmaster = async () => {}
		inst.eventmaster = new EventMaster('127.0.0.1')
		inst.notificationPort = cfg?.notification_port || 3000
		return inst
	}

	const a = mk({})
	await a.getAllDataFromEventmaster()
	a.refreshDefinitions()

	// --- Config form: Companion 5 refuses to save while a number field has no value, and existing
	// connections keep the config they were created with. This is the stored config of a connection
	// made on stock 4.4.5; every number field must have a value in it.
	const fields = a.getConfigFields()
	check('no fast state polling setting', !fields.some((fl) => /statePoll/i.test(fl.id)))
	const stock445 = {
		host: '192.168.0.175',
		pollingInterval: 15,
		enable_notifications: true,
		notification_port: 3000,
		auth_mode: 'none',
		notification_host: '192.168.0.15',
	}
	const unset = fields.filter((fl) => fl.type === 'number' && stock445[fl.id] === undefined).map((fl) => fl.id)
	check(`stock 4.4.5 config has a value for every number field (${unset.join(', ') || 'none missing'})`, !unset.length)
	check('no poller methods left', a.startStatePoller === undefined && a.statePollTick === undefined)

	// --- Live updates
	const b = mk({ enable_notifications: true, notification_port: 3101, notification_host: '127.0.0.1' })
	let structureRefreshes = 0
	const origB = b.refreshStructure.bind(b)
	b.refreshStructure = async (r) => {
		structureRefreshes++
		return origB(r)
	}
	await b.setupNotifications()
	check('subscribed status', await until(() => b.vars.live_updates_status === 'Subscribed'))
	const sp = frame.subs[frame.subs.length - 1]
	check(
		'subscribe sends string port + structural events',
		sp.port === '3101' && sp.notification.includes('PresetChanged') && sp.notification.includes('ScreenDestChanged'),
	)
	check('subscribe includes InputCfgChanged (source freeze)', sp.notification.includes('InputCfgChanged'))
	await notify('PresetChanged')
	check('PresetChanged triggers structure refresh', await until(() => structureRefreshes === 1, 2000))
	check('live_updates_last set', /PresetChanged x1/.test(b.vars.live_updates_last || ''))
	await wait(300) // let the fire-and-forget tally pass after the refresh finish
	const since = (t0, method, id) =>
		frame.calls.slice(t0).filter((c) => c.method === method && (id === undefined || c.params?.id === id)).length

	// Source frozen elsewhere: InputCfgChanged -> listSources only
	let t = frame.calls.length
	check('source 2 starts unfrozen', b.vars.source_2_frozen === 'No')
	frame.sources[1].Freeze = 1
	await notify('InputCfgChanged', [1])
	check('InputCfgChanged picks up external source freeze', await until(() => b.vars.source_2_frozen === 'Yes', 2000))
	await wait(100)
	check(
		`InputCfgChanged: targeted read, no structure refresh (refreshes ${structureRefreshes}, listSources ${since(t, 'listSources')}, listPresets ${since(t, 'listPresets')})`,
		structureRefreshes === 1 && since(t, 'listSources') === 1 && since(t, 'listPresets') === 0,
	)
	frame.sources[1].Freeze = 0
	await notify('InputCfgChanged', [1])
	check('InputCfgChanged picks up unfreeze', await until(() => b.vars.source_2_frozen === 'No', 2000))

	// Screen frozen elsewhere: ScreenDestChanged [1] -> listDestinations + listContent for screen 1 only
	t = frame.calls.length
	frame.screens[1].DestOutMapCol.DestOutMap[0].FrzMode = 1
	await notify('ScreenDestChanged', [1])
	check(
		'ScreenDestChanged picks up external screen freeze (FrzMode)',
		await until(() => b.vars.screen_1_frozen === 'Yes', 2000),
	)
	await wait(100)
	check(
		'ScreenDestChanged [1]: re-reads only screen 1 content',
		since(t, 'listDestinations') === 1 && since(t, 'listContent', 1) === 1 && since(t, 'listContent', 0) === 0,
	)
	check('screen freeze: no structure refresh', structureRefreshes === 1)

	// A take streams one ScreenDestChanged per transition frame: one read once it settles
	t = frame.calls.length
	frame.content[0].pgmSrc = 1
	for (let i = 0; i < 30; i++) {
		await notify('ScreenDestChanged', [0])
		await wait(20)
	}
	check(
		'take: tally updated from targeted read',
		await until(() => (b.vars.source_2_pgm_destinations || '').includes('LED MAIN'), 2000),
	)
	await wait(700)
	check(`take burst of 30 -> one content read (${since(t, 'listContent', 0)})`, since(t, 'listContent', 0) === 1)
	check('take: tally for untouched screen kept from cache', since(t, 'listContent', 1) === 0)

	// Aux source change: AUXDestChanged -> listAuxContent for that aux only
	t = frame.calls.length
	frame.aux[0].pgmSrc = 0
	await notify('AUXDestChanged', [0])
	check(
		'AUXDestChanged updates aux tally',
		await until(() => (b.vars.source_1_pgm_destinations || '').includes('AUX Aux 1'), 2000),
	)
	check('AUXDestChanged: no screen content reads', since(t, 'listContent') === 0)

	// Aux frozen elsewhere: AUXDestChanged -> listDestinations picks up FrzMode
	t = frame.calls.length
	frame.auxes[0].FrzMode = 1
	await notify('AUXDestChanged', [0])
	check('AUXDestChanged picks up external aux freeze', await until(() => b.vars.aux_0_frozen === 'Yes', 2000))
	check('aux freeze: no structure refresh, one destinations read', since(t, 'listDestinations') === 1)
	frame.auxes[0].FrzMode = 0
	await notify('AUXDestChanged', [0])
	check('AUXDestChanged picks up aux unfreeze', await until(() => b.vars.aux_0_frozen === 'No', 2000))

	// Signal lost on an input: InputCfgChanged -> listSources
	frame.sources[1].InputCfgVideoStatus = 4
	await notify('InputCfgChanged', [1])
	check('signal loss -> source_2_signal = No signal', await until(() => b.vars.source_2_signal === 'No signal', 2000))
	const sig = (source, when) => b.feedbacks.source_signal_problem.callback({ options: { source, when } })
	check(
		'button saved before "Lights when" existed still means any problem',
		sig(1, undefined) === true && sig(0, undefined) === false,
	)
	check('Lights when any problem: lost input on, good input off', sig(1, 'problem') && !sig(0, 'problem'))
	check('Lights when Signal OK: good input on, lost input off', sig(0, 'ok') && !sig(1, 'ok'))
	check('Lights when No signal matches status 4 only', sig(1, '4') && !sig(1, '2') && !sig(0, '4'))
	frame.sources[1].InputCfgVideoStatus = 2
	await notify('InputCfgChanged', [1])
	check('format mismatch reported', await until(() => b.vars.source_2_signal === 'Format mismatch', 2000))
	check('Lights when Format mismatch matches, No signal does not', sig(1, '2') && !sig(1, '4') && sig(1, 'problem'))
	frame.sources[1].InputCfgVideoStatus = 1
	await notify('InputCfgChanged', [1])
	check('signal back -> OK', await until(() => b.vars.source_2_signal === 'OK', 2000))

	// Screen armed elsewhere: ScreenDestChanged [1] -> listContent(1) gives IsActive
	frame.content[1].armed = 1
	await notify('ScreenDestChanged', [1])
	check('screen arm -> screen_1_armed = Yes', await until(() => b.vars.screen_1_armed === 'Yes', 2000))
	check(
		'armed feedback on for screen 1 only',
		b.feedbacks.screen_armed.callback({ options: { destId: 1 } }) === true &&
			b.feedbacks.screen_armed.callback({ options: { destId: 0 } }) === false,
	)
	frame.content[1].armed = 0
	await notify('ScreenDestChanged', [1])
	check('screen unarm -> No', await until(() => b.vars.screen_1_armed === 'No', 2000))

	// Arm toggle: uses the reported armed state, and re-reads the screen afterwards
	const armToggle = () => b.actions.arm_unarm_destination.callback({ options: { destId: 1, arm: 'toggle' } })
	armToggle()
	check(
		'arm toggle arms an unarmed screen',
		await until(() => frame.content[1].armed === 1 && b.vars.screen_1_armed === 'Yes', 2000),
	)
	armToggle()
	check(
		'arm toggle again unarms',
		await until(() => frame.content[1].armed === 0 && b.vars.screen_1_armed === 'No', 2000),
	)
	frame.content[1].armed = 1 // armed from EMT
	await notify('ScreenDestChanged', [1])
	await until(() => b.vars.screen_1_armed === 'Yes', 2000)
	armToggle()
	check('arm toggle after an external arm unarms', await until(() => frame.content[1].armed === 0, 2000))
	await until(() => b.vars.screen_1_armed === 'No', 2000)

	// Test pattern on the aux: OutputCfgChanged carries the OUTPUT id (1), mapped to aux 0
	t = frame.calls.length
	frame.aux[0].tp = 3
	await notify('OutputCfgChanged', [1])
	check(
		'aux test pattern -> aux_0_test_pattern named',
		await until(() => b.vars.aux_0_test_pattern === '100% Color Bars', 2000),
	)
	await wait(100)
	check(
		'OutputCfgChanged [1]: re-reads only aux 0 (output 1 mapped to its owner)',
		since(t, 'listAuxContent', 0) === 1 && since(t, 'listContent') === 0 && since(t, 'listDestinations') === 0,
	)
	const tpfb = (dest, pattern) => b.feedbacks.test_pattern_active.callback({ options: { dest, pattern } })
	check(
		'test pattern feedback: any + exact match on aux, nothing on screen',
		tpfb('aux:0', 'any') && tpfb('aux:0', '3') && !tpfb('aux:0', '5') && !tpfb('screen:0', 'any'),
	)
	frame.aux[0].tp = 0
	await notify('OutputCfgChanged', [1])
	check('aux test pattern off -> Off', await until(() => b.vars.aux_0_test_pattern === 'Off', 2000))

	// An output id we can't place re-reads every destination's content
	t = frame.calls.length
	frame.content[1].tp = 3
	await notify('OutputCfgChanged', [9])
	check(
		'unplaced output id: screen 1 pattern still found',
		await until(() => b.vars.screen_1_test_pattern === '100% Color Bars', 2000),
	)
	check(
		'unplaced output id: all content re-read',
		since(t, 'listContent', 0) === 1 && since(t, 'listContent', 1) === 1 && since(t, 'listAuxContent', 0) === 1,
	)
	frame.content[1].tp = 0
	await notify('OutputCfgChanged', [2])
	await until(() => b.vars.screen_1_test_pattern === 'Off', 2000)
	check(
		'subscribe includes OutputCfgChanged',
		frame.subs[frame.subs.length - 1].notification.includes('OutputCfgChanged'),
	)

	// Rename arrives as an update to an existing id: treated as structural
	frame.auxes[0].Name = 'Aux Renamed'
	await notify('AUXDestChanged', [0])
	check('rename detected -> structure refresh', await until(() => structureRefreshes === 2, 2000))
	frame.auxes[0].Name = 'Aux 1'

	// Additions are structural even on a live type
	await notify('ScreenDestChanged', [], [2])
	check('add on ScreenDestChanged -> structure refresh', await until(() => structureRefreshes === 3, 2000))
	await wait(300)

	// Plans arriving while one runs are merged and run next, not dropped
	t = frame.calls.length
	const p1 = b.applyLiveUpdate({ full: false, sources: true, destinations: false, screens: [], auxes: [] })
	const p2 = b.applyLiveUpdate({ full: false, sources: false, destinations: true, screens: [1], auxes: [] })
	const p3 = b.applyLiveUpdate({ full: false, sources: false, destinations: true, screens: [0], auxes: [] })
	await Promise.all([p1, p2, p3])
	check(
		'overlapping live updates merged, none dropped',
		since(t, 'listContent', 0) === 1 && since(t, 'listContent', 1) === 1 && since(t, 'listDestinations') === 1,
	)

	// teardown unsubscribes the same events/port and frees the port
	await b.teardownNotifications()
	check('teardown unsubscribes (no subs left)', frame.subs.filter((s) => s.port === '3101').length === 0)
	check('teardown frees the listener port', await portFree(3101))
	check('status Off after teardown', b.vars.live_updates_status === 'Off')
	// can set up again on the same port (config change) without crashing
	await b.setupNotifications()
	check('re-setup on same port works', await until(() => b.vars.live_updates_status === 'Subscribed'))
	await b.teardownNotifications()

	// --- Heartbeat instead of the full poll while live updates work (short timings for the test)
	const hbi = mk({
		enable_notifications: true,
		notification_port: 3108,
		notification_host: '127.0.0.1',
		pollingInterval: 0.5,
	})
	hbi._heartbeatMs = 200
	hbi._backstopMs = 1500
	await hbi.getAllDataFromEventmaster()
	hbi.eventmasterPoller()
	check('before subscribing: full poll running', !!hbi.polling_interval)
	let hFull = 0
	const hRS = hbi.refreshStructure.bind(hbi)
	hbi.refreshStructure = async (r) => {
		hFull++
		return hRS(r)
	}
	await hbi.setupNotifications()
	check('subscribed -> live mode', await until(() => hbi._liveMode === true, 2000))
	check('live mode: full poll stopped, heartbeat running', !hbi.polling_interval && !!hbi._heartbeatTimer)
	hbi.eventmasterPoller() // e.g. the initial load finishing after the subscribe
	check('eventmasterPoller does not restart the full poll in live mode', !hbi.polling_interval)
	let t0 = frame.calls.length
	await wait(1000)
	const hb = frame.calls.slice(t0).filter((c) => c.method === 'powerStatus').length
	const fullReads = frame.calls.slice(t0).filter((c) => c.method === 'listPresets').length
	check(
		'heartbeat is one call (' + hb + ' powerStatus in 1 s at 200 ms), no full reads yet (' + fullReads + ')',
		hb >= 3 && hb <= 6 && fullReads === 0,
	)
	check('backstop full refresh runs', await until(() => hFull >= 1, 2000))

	// Frame reboots: unreachable, comes back with no subscriptions
	const warnsBefore = hbi.logs.filter(([l, m]) => l === 'warn' && /not responding/.test(m)).length
	frame.up = false
	await wait(1000)
	const downWarns = hbi.logs.filter(([l, m]) => l === 'warn' && /not responding/.test(m)).length - warnsBefore
	check('outage logged once (' + downWarns + '), not every heartbeat', downWarns === 1)
	frame.subs = frame.subs.filter((s) => s.port !== '3108') // a reboot forgets subscriptions
	const fullBefore = hFull
	frame.up = true
	check('frame back -> re-subscribed', await until(() => frame.subs.some((s) => s.port === '3108'), 3000))
	check('frame back -> full refresh', await until(() => hFull > fullBefore, 3000))
	check(
		'frame back logged',
		hbi.logs.some(([l, m]) => l === 'info' && /responding again/.test(m)),
	)

	// Live updates stop working: back to the full poll
	hbi._notificationListener.onSubscribed(false, 'test')
	check(
		'subscribe failure -> full poll restored, heartbeat stopped',
		!hbi._liveMode && !!hbi.polling_interval && !hbi._heartbeatTimer,
	)
	await hbi.teardownNotifications()
	if (hbi.polling_interval) clearInterval(hbi.polling_interval)

	// Polling interval 0 means no polling at all, heartbeat included
	const z0 = mk({
		enable_notifications: true,
		notification_port: 3109,
		notification_host: '127.0.0.1',
		pollingInterval: 0,
	})
	await z0.setupNotifications()
	await until(() => z0._liveMode === true, 2000)
	check('pollingInterval 0: live mode without heartbeat or backstop', !z0._heartbeatTimer && !z0._backstopTimer)
	await z0.teardownNotifications()
	check('teardown leaves live mode', !z0._liveMode)

	// --- Subscribe rejected
	frame.subscribeSuccess = 1
	const c = mk({ enable_notifications: true, notification_port: 3102, notification_host: '127.0.0.1' })
	await c.setupNotifications()
	check('subscribe rejection reported', await until(() => /Subscribe failed/.test(c.vars.live_updates_status || '')))
	check(
		'subscribe rejection logged as error',
		c.logs.some(([l, m]) => l === 'error' && m.includes('subscribe failed')),
	)
	await c.teardownNotifications()
	frame.subscribeSuccess = 0

	// --- Port in use
	const blocker = net.createServer().listen(3103)
	await wait(100)
	const d = mk({ enable_notifications: true, notification_port: 3103, notification_host: '127.0.0.1' })
	await d.setupNotifications()
	check('port-in-use reported, no crash', await until(() => /already in use/.test(d.vars.live_updates_status || '')))
	await d.teardownNotifications()
	blocker.close()

	// --- Teardown with frame unreachable doesn't hang
	const e = mk({ enable_notifications: true, notification_port: 3104, notification_host: '127.0.0.1' })
	await e.setupNotifications()
	await until(() => e.vars.live_updates_status === 'Subscribed')
	frame.up = false
	const tt = Date.now()
	await e.teardownNotifications()
	frame.up = true
	check(`teardown with frame down completes (${Date.now() - tt}ms)`, Date.now() - tt < 3000)

	// --- Listener IP selection
	const realNI = os.networkInterfaces
	os.networkInterfaces = () => ({
		WiFi: [{ family: 'IPv4', internal: false, address: '10.20.30.40' }],
		Ethernet: [{ family: 'IPv4', internal: false, address: '192.168.0.15' }],
	})
	const f = mk({ host: '192.168.0.180' })
	f.notificationHost = undefined
	check('picks interface on frame subnet over first interface', f.getNotificationHost() === '192.168.0.15')
	const g = mk({ host: '172.16.5.5' })
	g.notificationHost = undefined
	check(
		'falls back to first interface with a warning',
		g.getNotificationHost() === '10.20.30.40' && g.logs.some(([l]) => l === 'warn'),
	)
	const h = mk({ host: '192.168.0.180', notification_host: '10.9.9.9' })
	h.notificationHost = undefined
	check('configured listener IP wins', h.getNotificationHost() === '10.9.9.9')
	os.networkInterfaces = realNI

	// --- Variable defs
	a.updateDestinationVariables = a.updateDestinationVariables.bind(a)
	a.autoPopulateSourceMonitoring = async () => {}
	a.lastVariableDefinitionsHash = null
	a.updateDestinationVariables()
	const ids = a.varDefs.map((v) => v.variableId)
	check(
		'status variables defined',
		['live_updates_status', 'live_updates_last'].every((v) => ids.includes(v)),
	)
	check('frame_connection variable gone with the poller', !ids.includes('frame_connection'))
	a.setStatusVariables({ live_updates_status: 'Subscribed' })
	a.lastVariableDefinitionsHash = null
	a.vars.live_updates_status = undefined
	a.updateDestinationVariables()
	check('status values re-applied after definitions change', a.vars.live_updates_status === 'Subscribed')

	console.log(fails ? `\n${fails} FAILED` : '\nAll passed')
	server.close()
	process.exit(fails ? 1 : 0)
})
