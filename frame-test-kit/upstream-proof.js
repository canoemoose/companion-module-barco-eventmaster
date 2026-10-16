// Upstream proof harness: runs UPSTREAM's own module code (9f84de7, unchanged, from a git worktree)
// against a real frame, one claim at a time, and saves a transcript of every JSON-RPC request and
// reply, every notification that arrives, and the module's own log. Evidence for the upstream PRs:
// see docs/upstream-prs-scope.md, "Upstream claims to prove on hardware".
//
// One-time setup (from the repo): git worktree add --detach ../eventmaster-upstream-9f84de7 9f84de7
// Upstream's dependencies are the fork's, so it runs on this repo's node_modules.
//
// Run with Companion's node18 (its firewall rule covers any port):
//   & "C:\Program Files\Companion\resources\node-runtimes\node18\node.exe" frame-test-kit\upstream-proof.js --frame 192.168.0.175 --claim 2
//
//   --frame IP       frame address (required)
//   --claim N        1 to 6 (see CLAIMS below)
//   --local IP       this PC's address the frame sends notifications to (default 192.168.0.100)
//   --port N         first local port to use (default 3006; a claim may use up to four from here)
//   --hold N         seconds to hold a watched change (claims 1 and 6, default 20)
//   --upstream DIR   upstream checkout (default ../../eventmaster-upstream-9f84de7 from this file)
//
// Claims 1 and 6 change what is on an output and need someone watching it. Claims 2, 3 and 5 toggle
// screen 0's arm state (put back as found) to make the frame send ScreenDestChanged. Claims 3 and 4
// run upstream in a child process, so a crash is recorded as an exit code rather than ending the run.
'use strict'
/* eslint-disable n/no-process-exit -- standalone CLI */
const Module = require('module')
const http = require('http')
const fs = require('fs')
const path = require('path')
const { spawn } = require('child_process')

const argv = process.argv.slice(2)
const arg = (n, d) => {
	const i = argv.indexOf(n)
	return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : d
}
const FRAME = arg('--frame', '')
const CLAIM = Number(arg('--claim', 0))
const LOCAL = arg('--local', '192.168.0.100')
const PORT = Number(arg('--port', 3006))
const HOLD = Number(arg('--hold', 20))
const UPSTREAM = path.resolve(arg('--upstream', path.join(__dirname, '..', '..', 'eventmaster-upstream-9f84de7')))
const CHILD = argv.includes('--child')
const REPO = path.resolve(__dirname, '..')
const OUT_DIR = path.join(__dirname, 'results')
if (!FRAME || !(CLAIM >= 1 && CLAIM <= 6)) {
	console.log('Usage: upstream-proof.js --frame <ip> --claim <1-6> [--local ip] [--port 3006] [--hold 20]')
	process.exit(1)
}
if (!fs.existsSync(path.join(UPSTREAM, 'eventmaster.js'))) {
	console.log(`Upstream checkout not found at ${UPSTREAM}`)
	console.log('Create it: git worktree add --detach ../eventmaster-upstream-9f84de7 9f84de7')
	process.exit(1)
}

// Resolve upstream's requires (barco-eventmaster, lodash, ping, express) from this repo's node_modules
process.env.NODE_PATH = path.join(REPO, 'node_modules')
Module._initPaths()

// ---------- transcript ----------
const t0 = Date.now()
const lines = []
const stamp = () => `${new Date().toTimeString().slice(0, 8)} +${((Date.now() - t0) / 1000).toFixed(1)}s`
const say = (s = '') => {
	const line = s ? `${stamp()}  ${s}` : ''
	console.log(line)
	lines.push(line)
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

// Every JSON-RPC call the library makes (upstream's and the harness's), with its reply
const EventMaster = require('barco-eventmaster')
const origPost = EventMaster.prototype.postJsonRpc
EventMaster.prototype.postJsonRpc = function (method, params, callback) {
	const tag = this.__tag || 'lib'
	const quiet = /^list|^get|^powerStatus/.test(method) && !this.__loud
	// Show what the caller passed, functions and undefined included, then what goes on the wire
	const passed = JSON.stringify(params, (k, v) =>
		typeof v === 'function' ? '[function]' : v === undefined ? '[undefined]' : v,
	)
	const wire = JSON.stringify(params)
	if (!quiet) say(`RPC ${tag} -> ${method} ${passed}${passed !== wire ? `  (on the wire: ${wire ?? 'nothing'})` : ''}`)
	return origPost.call(this, method, params, (err, res) => {
		if (!quiet) say(`RPC ${tag} <- ${method} ${err ? `error ${err.message || err}` : JSON.stringify(res)}`)
		if (typeof callback === 'function') callback(err, res)
	})
}

// Every notification server upstream starts, numbered; whether it really listens (Express 5 hands a
// listen error to the library's callback, which logs "listening" regardless); what reaches it
let serverCount = 0
const origStart = EventMaster.prototype.startNotificationServer
EventMaster.prototype.startNotificationServer = function (port, onNotification) {
	const n = ++serverCount
	say(`SERVER #${n} upstream notification server starting on port ${port}`)
	const r = origStart.call(this, port, (body) => {
		say(`NOTIFY upstream server #${n} (port ${port}) <- ${(body?.result || body)?.notificationType ?? '?'}`)
		onNotification(body)
	})
	this.notificationServer?.on('listening', () => say(`SERVER #${n} is listening on ${port}`))
	this.notificationServer?.on('error', (e) => say(`SERVER #${n} listen FAILED on ${port}: ${e.code || e.message}`))
	this.notificationServer?.on('close', () => say(`SERVER #${n} on ${port} closed`))
	return r
}
// Is anything still answering on a local port? (a leaked server)
const probe = (port) =>
	new Promise((resolve) => {
		const req = http.request({ host: '127.0.0.1', port, method: 'POST', path: '/', timeout: 3000 }, (res) => {
			res.resume()
			resolve(`answered HTTP ${res.statusCode}`)
		})
		req.on('timeout', () => req.destroy(new Error('timeout')))
		req.on('error', (e) => resolve(`no answer (${e.code || e.message})`))
		req.setHeader('content-type', 'application/json')
		req.end('{"result":{"method":"notification","notificationType":"ProbeOnly","change":{}}}')
	})

// The harness's own client, "another client" to the frame
const em = new EventMaster(FRAME)
em.__tag = 'harness'
const call = (method, params, loud = true) =>
	new Promise((resolve) => {
		em.__loud = loud
		em.postJsonRpc(method, params, (err, res) => resolve(err ? { error: String(err.message || err) } : res))
	})

// The frame's raw HTTP reply to a request (the library keeps only `result`, dropping an `error`)
const rawCall = (method, params) =>
	new Promise((resolve) => {
		const req = http.request(
			{
				host: FRAME,
				port: 9999,
				path: '/jsonrpc',
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				timeout: 8000,
			},
			(res) => {
				let d = ''
				res.on('data', (c) => (d += c))
				res.on('end', () => resolve(d))
			},
		)
		req.on('timeout', () => req.destroy(new Error('timeout')))
		req.on('error', (e) => resolve(`transport error ${e.message}`))
		req.end(JSON.stringify({ jsonrpc: '2.0', id: '0', method, params }))
	})

// A listener standing in for a subscriber (e.g. a previous module run), recording what arrives
function listener(port, label) {
	const got = []
	const server = http.createServer((req, res) => {
		let d = ''
		req.on('data', (c) => (d += c))
		req.on('end', () => {
			let type = '?'
			try {
				const n = JSON.parse(d)
				type = (n.result || n).notificationType || '?'
			} catch {
				// keep '?'
			}
			got.push({ at: Date.now(), type })
			say(`NOTIFY ${label} (port ${port}) <- ${type} ${d.slice(0, 160)}`)
			res.end('OK')
		})
	})
	return new Promise((resolve, reject) => {
		server.once('error', reject)
		server.listen(port, () => resolve({ got, close: () => new Promise((r) => server.close(() => r())) }))
	})
}

// Make the frame send ScreenDestChanged: toggle screen 0's arm and put it back
async function screenChange(why) {
	const before = (await call('listContent', { id: 0 }, false))?.response?.IsActive
	say(`CHANGE (${why}): arm toggle on screen 0, from IsActive ${before}`)
	await call('armUnarmDestination', { arm: before ? 0 : 1, ScreenDestination: [{ id: 0 }], AuxDestination: [] })
	await wait(1500)
	await call('armUnarmDestination', { arm: before ? 1 : 0, ScreenDestination: [{ id: 0 }], AuxDestination: [] })
	await wait(1500)
	const after = (await call('listContent', { id: 0 }, false))?.response?.IsActive
	say(`CHANGE done: screen 0 IsActive back to ${after}`)
}

// ---------- upstream module under a minimal stand-in for Companion's host ----------
let Captured
const origLoad = Module._load
Module._load = function (req) {
	if (req === '@companion-module/base') {
		class InstanceBase {
			constructor() {
				this.vars = {}
			}
			log(level, msg) {
				say(`MODULE ${level}: ${msg}`)
			}
			setVariableValues(v) {
				Object.assign(this.vars, v)
			}
			setVariableDefinitions() {}
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
			updateStatus(s, m) {
				this.status = m ? `${s}: ${m}` : s
			}
		}
		return {
			InstanceBase,
			InstanceStatus: {
				Ok: 'ok',
				ConnectionFailure: 'connection_failure',
				Connecting: 'connecting',
				UnknownWarning: 'unknown_warning',
				BadConfig: 'bad_config',
			},
			Regex: { IP: '' },
			runEntrypoint: (c) => (Captured = c),
			combineRgb: (r, g, b) => (r << 16) + (g << 8) + b,
		}
	}
	return origLoad.apply(this, arguments)
}

// The checkout's commit (and branch, if it's on one)
function upstreamCommit() {
	try {
		const out = require('child_process')
			.execFileSync('git', ['-C', UPSTREAM, 'log', '-1', '--format=%h%d'], { encoding: 'utf8' })
			.trim()
		return out || 'unknown'
	} catch {
		return 'unknown'
	}
}

async function newUpstream(config) {
	require(path.join(UPSTREAM, 'eventmaster.js'))
	const inst = new Captured({})
	const base = {
		host: FRAME,
		polling_interval: 0, // no full poll: only what the claim does reaches the frame
		enable_notifications: false,
		notification_host: LOCAL,
		auth_mode: 'none',
	}
	await inst.init({ ...base, ...config })
	return inst
}
const waitConnected = async (inst, ms = 15000) => {
	const t = Date.now()
	while (Date.now() - t < ms) {
		if (inst.eventmaster && inst.status === 'ok') return true
		await wait(100)
	}
	return false
}

// ---------- claims ----------
const CLAIMS = {
	// 1: upstream's aux "Off" test pattern preset sends screenDestination; the action reads
	// auxDestination, so it sends id NaN. Does the pattern on the aux go off?
	async 1() {
		const inst = await newUpstream({})
		if (!(await waitConnected(inst))) return say('RESULT could not connect')
		await wait(3000) // first data load and definitions
		const presets = Object.entries(inst.presets || {}).filter(
			([, p]) => p.steps?.[0]?.down?.[0]?.actionId === 'testpattern_on_AUX',
		)
		say(`FACT upstream builds ${presets.length} aux test pattern presets`)
		for (const [key, p] of presets.filter(([, x]) => x.steps[0].down[0].options.testPattern === '0'))
			say(`FACT preset ${key} (${p.name || p.style?.text}) options ${JSON.stringify(p.steps[0].down[0].options)}`)
		const off = presets.find(([, x]) => x.steps[0].down[0].options.testPattern === '0')
		if (!off) return say('RESULT no aux Off preset (frame has no aux?)')
		const auxId = Number(
			off[1].steps[0].down[0].options.screenDestination ?? off[1].steps[0].down[0].options.auxDestination,
		)
		const tp = async () => {
			const c = (await call('listAuxContent', { id: auxId }, false))?.response
			return []
				.concat(c?.OutputCfg ?? [])
				.flatMap((o) => [].concat(o?.OutputAOI ?? []))
				.flatMap((a) => [].concat(a?.TestPattern ?? []))
				.map((x) => x.TestPatternMode)
		}
		const found = (await tp())[0] ?? 0
		say(`READ aux ${auxId} TestPatternMode before: ${found} (put back at the end)`)
		say(`STEP 1: color bars on aux ${auxId} from another client (watch the aux output: bars should appear)`)
		await call('changeAuxContent', { id: auxId, TestPattern: 3 })
		await wait(1500)
		say(`READ aux ${auxId} TestPatternMode: ${JSON.stringify(await tp())}`)
		say(
			`STEP 2: press upstream's aux Off preset (its action callback with the preset's options); watch: do the bars go off?`,
		)
		inst.actions.testpattern_on_AUX.callback({ options: off[1].steps[0].down[0].options })
		await wait(HOLD * 1000)
		say(`READ aux ${auxId} TestPatternMode ${HOLD} s after the Off preset: ${JSON.stringify(await tp())}`)
		say(`STEP 3 (control): the same action with auxDestination set, as the other 20 presets do`)
		inst.actions.testpattern_on_AUX.callback({ options: { auxDestination: String(auxId), testPattern: '0' } })
		await wait(3000)
		say(`READ aux ${auxId} TestPatternMode after the control: ${JSON.stringify(await tp())}`)
		await call('changeAuxContent', { id: auxId, TestPattern: found }) // put back as found
		say(`READ aux ${auxId} TestPatternMode put back: ${JSON.stringify(await tp())}`)
		return inst
	},

	// 2: "Unsubscribe to start clean" is unsubscribe(callback): the callback lands in the hostname
	// slot. Does a subscription left by a previous run survive it?
	async 2() {
		const oldPort = PORT + 1
		const old = await listener(oldPort, 'previous run')
		const sub = { hostname: LOCAL, port: String(oldPort), notification: ['ScreenDestChanged', 'AUXDestChanged'] }
		say(`STEP 1: a previous run's subscription: ${LOCAL}:${oldPort}`)
		await call('subscribe', sub)
		await screenChange('previous run is subscribed')
		const before = old.got.length
		say(`FACT previous-run listener received ${before} notification(s) before upstream starts`)
		say(`STEP 2: upstream starts with live updates on ${LOCAL}:${PORT} ("unsubscribe to start clean" first)`)
		const inst = await newUpstream({ enable_notifications: true, notification_port: PORT })
		if (!(await waitConnected(inst))) return say('RESULT could not connect')
		await wait(3000)
		await screenChange('after upstream "started clean"')
		await wait(1000)
		const after = old.got.length - before
		say(`FACT previous-run listener received ${after} notification(s) after upstream's clean start`)
		say(`FACT the frame's raw reply to the request upstream sent (unsubscribe {}): ${await rawCall('unsubscribe', {})}`)
		say(`STEP 3 (control): unsubscribe the previous run properly, change again`)
		await call('unsubscribe', sub)
		const n3 = old.got.length
		await screenChange('after a proper unsubscribe')
		await wait(1000)
		say(`FACT previous-run listener received ${old.got.length - n3} notification(s) after a proper unsubscribe`)
		await old.close()
		return inst
	},

	// 3: teardown never stops the notification server. A config save starts another server on the
	// same port (which fails, silently); a port change leaves the old one bound. Runs in a child.
	async 3() {
		const inst = await newUpstream({ enable_notifications: true, notification_port: PORT })
		if (!(await waitConnected(inst))) return say('RESULT could not connect')
		await wait(3000)
		await screenChange('before any config change')
		await wait(1000)
		say(`STEP 1: Companion calls configUpdated with the same settings (any config save)`)
		await inst.configUpdated({ ...inst.config })
		await waitConnected(inst)
		await wait(4000)
		await screenChange('after the same-port config save: which server receives?')
		await wait(1000)
		const newPort = PORT + 1
		say(`STEP 2: configUpdated with the notification port changed ${PORT} -> ${newPort}`)
		await inst.configUpdated({ ...inst.config, notification_port: newPort })
		await waitConnected(inst)
		await wait(4000)
		await screenChange('after the port change')
		await wait(1000)
		say(`FACT old port ${PORT} after the port change: ${await probe(PORT)}`)
		say(`FACT new port ${newPort}: ${await probe(newPort)}`)
		return inst
	},

	// 4: the notification port is held by another process. Runs in a child; the parent holds the port
	// and records what reaches it.
	async 4() {
		say(`STEP: upstream starts with live updates on port ${PORT}, which another process holds`)
		const inst = await newUpstream({ enable_notifications: true, notification_port: PORT })
		if (!(await waitConnected(inst))) return say('RESULT could not connect')
		await wait(3000)
		await screenChange('upstream believes it is listening')
		await wait(1000)
		say(`FACT module status: ${inst.status}; module process still running`)
		return inst
	},

	// 5: upstream subscribes with a numeric port. Does the frame accept it, and do notifications arrive?
	async 5() {
		const numPort = PORT + 2
		const strPort = PORT + 3
		const num = await listener(numPort, 'numeric port')
		const str = await listener(strPort, 'string port')
		const types = ['ScreenDestChanged', 'AUXDestChanged']
		say(`STEP: subscribe ${LOCAL}:${numPort} as a number (as upstream does) and ${LOCAL}:${strPort} as a string`)
		const a = await call('subscribe', { hostname: LOCAL, port: numPort, notification: types })
		const b = await call('subscribe', { hostname: LOCAL, port: String(strPort), notification: types })
		say(`FACT replies: number ${JSON.stringify(a)}, string ${JSON.stringify(b)}`)
		await screenChange('both subscribed')
		await wait(1000)
		say(`FACT received: numeric port ${num.got.length}, string port ${str.got.length}`)
		await call('unsubscribe', { hostname: LOCAL, port: numPort, notification: types })
		await call('unsubscribe', { hostname: LOCAL, port: String(strPort), notification: types })
		await num.close()
		await str.close()
	},

	// 6: on a PDS-4K, upstream's Freeze/Unfreeze Source and Freeze/Unfreeze Destination don't freeze
	// the picture. Watched; control is a layer freeze.
	async 6() {
		const inst = await newUpstream({})
		if (!(await waitConnected(inst))) return say('RESULT could not connect')
		await wait(3000)
		const content = (await call('listContent', { id: 0 }, false))?.response
		const layer = [].concat(content?.Layers ?? []).find((l) => l.PgmMode > 0 && l.LastSrcIdx >= 0)
		if (!layer) return say('RESULT no layer on program on screen 0: put a moving source on program first')
		const src = layer.LastSrcIdx
		const readSrc = async () => (await call('listSources', { type: 0 }, false))?.response?.find((s) => s.id === src)
		const readScreen = async () => {
			const d = (await call('listDestinations', { type: 0 }, false))?.response
			const sc = [].concat(d?.ScreenDestination ?? []).find((s) => s.id === 0)
			return [].concat(sc?.DestOutMapCol?.DestOutMap ?? sc?.DestOutMapColl ?? []).map((o) => o.FrzMode ?? o.Freeze)
		}
		say(`FACT screen 0 program layer ${layer.id} ${layer.Name} shows source ${src} "${(await readSrc())?.Name}"`)
		say(`STEP 1: upstream "Freeze/Unfreeze Source" (frz_Source) freeze source ${src}, held ${HOLD} s: watch the output`)
		inst.actions.frz_Source.callback({ options: { frzType: 1, frzSource: src } })
		await wait(1500)
		say(`READ source ${src} Freeze: ${(await readSrc())?.Freeze}`)
		await wait(HOLD * 1000)
		inst.actions.frz_Source.callback({ options: { frzType: 0, frzSource: src } })
		await wait(1500)
		say(`READ source ${src} Freeze after unfreeze: ${(await readSrc())?.Freeze}`)
		await wait(5000)
		say(`STEP 2: upstream "Freeze/Unfreeze Destination" (freeze_dest) on screen 0, held ${HOLD} s: watch the output`)
		inst.actions.freeze_dest.callback({ options: { destId: 0, freeze: 1 } })
		await wait(1500)
		say(`READ screen 0 output FrzMode: ${JSON.stringify(await readScreen())}`)
		await wait(HOLD * 1000)
		inst.actions.freeze_dest.callback({ options: { destId: 0, freeze: 0 } })
		await wait(1500)
		say(`READ screen 0 output FrzMode after unfreeze: ${JSON.stringify(await readScreen())}`)
		await wait(5000)
		say(`STEP 3 (control): layer freeze on layer ${layer.id} (changeContent), held ${HOLD} s: the output should freeze`)
		await call('changeContent', { id: 0, Layers: [{ id: layer.id, Freeze: 1 }] })
		await wait(HOLD * 1000)
		await call('changeContent', { id: 0, Layers: [{ id: layer.id, Freeze: 0 }] })
		await wait(1000)
		return inst
	},
}

// ---------- run ----------
async function stopUpstream(inst) {
	if (!inst) return
	try {
		await inst.teardownNotifications?.()
		await inst.destroy?.()
	} catch (e) {
		say(`cleanup: ${e?.message || e}`)
	}
	try {
		inst._notificationListener?.em?.stopNotificationServer?.()
	} catch {
		// best-effort
	}
}

async function runHere() {
	const fsr = (await call('getFrameSettings', {}, false))?.response?.System?.FrameCollection?.Frame || {}
	const frame = `${fsr.FrameTypeName ?? '?'} ${fsr.Version ?? '?'}`
	say(`Upstream proof, claim ${CLAIM}, against ${FRAME} (${frame}), upstream ${upstreamCommit()} at ${UPSTREAM}`)
	let inst
	try {
		inst = await CLAIMS[CLAIM]()
	} catch (e) {
		say(`HARNESS error: ${e?.stack || e}`)
	}
	await stopUpstream(inst)
	return frame
}

function save(frame) {
	fs.mkdirSync(OUT_DIR, { recursive: true })
	const safe = (s) => String(s).replace(/[^\w.-]+/g, '_')
	const file = path.join(
		OUT_DIR,
		`upstream-proof-${CLAIM}_${safe(frame)}_${new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19)}.txt`,
	)
	fs.writeFileSync(file, lines.join('\n') + '\n')
	console.log(`Saved: ${file}`)
}

;(async () => {
	if (CHILD) {
		// Inside the child: run the claim; the parent records how it ends
		process.on('exit', (code) => console.log(`${stamp()}  CHILD exiting with code ${code}`))
		await runHere()
		await wait(500)
		process.exit(0)
	}
	if (CLAIM === 3 || CLAIM === 4) {
		const fsr = (await call('getFrameSettings', {}, false))?.response?.System?.FrameCollection?.Frame || {}
		const frame = `${fsr.FrameTypeName ?? '?'} ${fsr.Version ?? '?'}`
		let holder
		if (CLAIM === 4) {
			holder = http.createServer((q, r) => {
				let d = ''
				q.on('data', (c) => (d += c))
				q.on('end', () => {
					say(`PARENT (the other process on ${PORT}) received: ${d.slice(0, 160)}`)
					r.end('OK')
				})
			})
			await new Promise((r) => holder.listen(PORT, r))
			say(`PARENT holds port ${PORT} (another process using it)`)
		}
		say(`PARENT starts upstream in a child process`)
		const child = spawn(process.execPath, [__filename, ...argv, '--child'], { cwd: REPO })
		const relay = (prefix) => (b) =>
			String(b)
				.split(/\r?\n/)
				.filter(Boolean)
				.forEach((l) => {
					console.log(`${prefix}${l}`)
					lines.push(`${prefix}${l}`)
				})
		child.stdout.on('data', relay('[child] '))
		child.stderr.on('data', relay('[child stderr] '))
		const code = await new Promise((r) => child.on('exit', (c, sig) => r(sig || c)))
		say(`PARENT child process ended: ${code === 0 ? 'exit 0 (clean)' : `exit ${code}`}`)
		if (holder) holder.close()
		// Whatever the child left subscribed, clear it so the frame isn't left notifying this PC
		for (const p of [PORT, PORT + 1])
			for (const port of [p, String(p)])
				await call('unsubscribe', { hostname: LOCAL, port, notification: ['ScreenDestChanged', 'AUXDestChanged'] })
		save(frame)
		process.exit(0)
	}
	const frame = await runHere()
	save(frame)
	process.exit(0)
})()
