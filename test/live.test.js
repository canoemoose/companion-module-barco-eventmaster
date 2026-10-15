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
	sources: [{ id: 0, Name: 'Cam 1-1', InputCfgIndex: 0, DestIndex: -1, UserKeyIndex: -1, Freeze: 0 }],
	screens: [{ id: 0, Name: 'LED MAIN', DestOutMapColl: [{ id: 0, DestOutMap: [{ id: 0, Freeze: 0 }] }] }],
	content: { 0: { pgmSrc: -1 } },
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
		else if (method === 'listDestinations') response = { ScreenDestination: frame.screens, AuxDestination: [] }
		else if (method === 'listContent')
			response = {
				id: params.id,
				BGLyr: [],
				Layers: [{ id: 0, LastSrcIdx: frame.content[0].pgmSrc, PgmMode: 1, PvwMode: 0, Freeze: 0 }],
			}
		else if (method === 'listAuxContent') response = { id: params.id }
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
const notify = (type) => {
	const s = frame.subs[frame.subs.length - 1]
	const data = JSON.stringify({
		result: { method: 'notification', notificationType: type, change: { add: [], remove: [], update: [0] } },
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
	await notify('PresetChanged')
	check('PresetChanged triggers structure refresh', await until(() => structureRefreshes === 1, 2000))
	check('live_updates_last set', /PresetChanged x1/.test(b.vars.live_updates_last || ''))
	await notify('ScreenDestChanged')
	await notify('ScreenDestChanged')
	check(
		'burst debounced into one refresh',
		(await until(() => structureRefreshes === 2, 2000)) && (await wait(800), structureRefreshes === 2),
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
