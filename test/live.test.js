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
		{ id: 0, Name: 'Cam 1-1', InputCfgIndex: 0, DestIndex: -1, UserKeyIndex: -1, Freeze: 0 },
		{ id: 1, Name: 'Cam 2-2', InputCfgIndex: 1, DestIndex: -1, UserKeyIndex: -1, Freeze: 0 },
	],
	// Shapes as returned by 9.2.6318: DestOutMapCol is an object, screen and aux freeze is FrzMode
	screens: [
		{ id: 0, Name: 'LED MAIN', DestOutMapCol: { DestOutMap: [{ id: 0, FrzMode: 0 }] } },
		{ id: 1, Name: 'IMAG', DestOutMapCol: { DestOutMap: [{ id: 0, FrzMode: 0 }] } },
	],
	auxes: [{ id: 0, Name: 'Aux 1', AuxStreamMode: 1, FrzMode: 0 }],
	content: { 0: { pgmSrc: -1 }, 1: { pgmSrc: -1 } },
	aux: { 0: { pgmSrc: -1 } },
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
				BGLyr: [],
				Layers: [{ id: 0, LastSrcIdx: frame.content[params.id].pgmSrc, PgmMode: 1, PvwMode: 0, Freeze: 0 }],
			}
		else if (method === 'listAuxContent')
			response = { id: params.id, PgmLastSrcIndex: frame.aux[params.id].pgmSrc, PvwLastSrcIndex: -1 }
		else if (method === 'subscribe') {
			success = frame.subscribeSuccess
			frame.subs.push(params)
		} else if (method === 'unsubscribe') {
			frame.subs = frame.subs.filter((s) => !(s.hostname === params.hostname && s.port === params.port))
		} else if (method === 'listPresets' || method === 'listCues' || method === 'listUserKeys') response = []
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
		inst.config = { host: '127.0.0.1', statePollInterval: 0.5, ...cfg }
		inst.previousVariableValues = {}
		inst.frameVariableDefinitions = []
		inst.CHOICES_TESTPATTERN = []
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

	// --- Fast state polling
	const a = mk({})
	await a.getAllDataFromEventmaster()
	a.refreshDefinitions()
	a.startStatePoller()
	check('state poller started at 500ms', !!a.state_poll_interval)
	check('frame_connection Online after first tick', await until(() => a.vars.frame_connection === 'Online'))
	frame.sources[0].Freeze = 1 // frozen from EM Toolset; no notification
	check('external freeze picked up by state poll within ~1s', await until(() => a.vars.source_1_frozen === 'Yes', 1500))
	frame.content[0].pgmSrc = 0 // source taken to program elsewhere
	check(
		'external tally change picked up by state poll',
		await until(() => (a.vars.source_1_pgm_destinations || '').includes('LED MAIN'), 1500),
	)

	// no overlapping ticks
	const t0 = frame.calls.length
	await wait(1600)
	const ticks = frame.calls.slice(t0).filter((c) => c.method === 'listSources').length
	check(`poll rate sane (${ticks} source reads in 1.6s at 500ms)`, ticks >= 2 && ticks <= 4)

	// --- Frame dropout and recovery
	let resub = 0
	a.resubscribeNotifications = () => resub++
	let refreshed = 0
	const origRS = a.refreshStructure.bind(a)
	a.refreshStructure = async (r) => {
		refreshed++
		return origRS(r)
	}
	frame.up = false
	check('frame_connection Offline after outage', await until(() => a.vars.frame_connection === 'Offline', 3000))
	await wait(1200)
	const warns = a.logs.filter(([l, m]) => l === 'warn' && m.includes('not responding')).length
	check(`outage logged once, not every tick (${warns})`, warns === 1)
	frame.up = true
	check('frame_connection Online after recovery', await until(() => a.vars.frame_connection === 'Online', 2000))
	check('recovery triggers resubscribe + structure refresh', resub === 1 && refreshed >= 1)
	a.stopStatePoller()

	// --- State polling disabled
	const z = mk({ statePollInterval: 0 })
	z.startStatePoller()
	check('statePollInterval 0 disables poller', !z.state_poll_interval)
	const u = mk({})
	delete u.config.statePollInterval
	u.startStatePoller()
	check('missing setting (existing configs) defaults to off', !u.state_poll_interval)
	u.stopStatePoller()

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
		['frame_connection', 'live_updates_status', 'live_updates_last'].every((v) => ids.includes(v)),
	)
	check('status values re-applied after definitions change', a.vars.frame_connection === 'Online')

	console.log(fails ? `\n${fails} FAILED` : '\nAll passed')
	server.close()
	process.exit(fails ? 1 : 0)
})
