// Event Master frame test kit. Node 18, built-ins only. Normally launched by Run-FrameTests.ps1.
//
// Changes nothing on the frame: it only calls subscribe/unsubscribe and read-only list/get methods.
// Anything that changes the show is done by the operator in EMT when prompted.
//
//   node kit.js [--frame 192.168.0.175] [--local 192.168.0.100] [--port 3000]
//               [--phases id,preflight,naming,ready,A,C] [--settle 3] [--out results]
//               [--operator-id N | --password P] [--json-port 9999] [--xml-port 9876]
//               [--steps A1,A2] (rerun just these steps)
//   Rehearsal only: --auto --mock-control http://127.0.0.1:9999/_mock/do
/* eslint-disable n/no-process-exit -- standalone CLI */
'use strict'
const http = require('http')
const net = require('net')
const os = require('os')
const fs = require('fs')
const path = require('path')
const readline = require('readline')
const { execFileSync } = require('child_process')

// ---------- arguments ----------
const argv = process.argv.slice(2)
const arg = (n, d) => {
	const i = argv.indexOf(n)
	return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : d
}
const flag = (n) => argv.includes(n)
const cfg = {
	frame: arg('--frame', '192.168.0.175'),
	local: arg('--local', '192.168.0.100'),
	port: Number(arg('--port', 3000)),
	jsonPort: Number(arg('--json-port', 9999)),
	xmlPort: Number(arg('--xml-port', 9876)),
	settleMs: Number(arg('--settle', 3)) * 1000,
	out: arg('--out', path.join(__dirname, 'results')),
	phases: arg('--phases', 'id,preflight,prep,naming,ready,A,C').split(','),
	steps: arg('--steps', ''),
	operatorId: arg('--operator-id', ''),
	password: arg('--password', ''),
	auto: flag('--auto'),
	mockControl: arg('--mock-control', ''),
	noPktmon: flag('--no-pktmon'),
	wrapperNotes: arg('--wrapper-notes', ''),
}

const NOTIFICATION_TYPES = [
	'ScreenDestChanged',
	'AUXDestChanged',
	'FrameChanged',
	// No NativeRateChanged: the PDS-4K rejects the whole subscribe if it is listed
	'SourceChanged',
	'BGSourceChanged',
	'CueChanged',
	'PresetChanged',
	'StillChanged',
	'InputCfgChanged',
	'OutputCfgChanged',
]

// ---------- console ----------
const C = process.stdout.isTTY
	? { b: '\x1b[1m', g: '\x1b[32m', y: '\x1b[33m', r: '\x1b[31m', c: '\x1b[36m', x: '\x1b[0m' }
	: { b: '', g: '', y: '', r: '', c: '', x: '' }
const say = (s = '') => console.log(s)
const ok = (s) => say(`  ${C.g}OK${C.x}    ${s}`)
const warn = (s) => say(`  ${C.y}WARN${C.x}  ${s}`)
const bad = (s) => say(`  ${C.r}FAIL${C.x}  ${s}`)
const head = (s) => say(`\n${C.b}${C.c}== ${s} ==${C.x}`)
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const stamp = () => new Date().toISOString()

let rl = null
let inputClosed = false
// Closed input (piped stdin ran out) answers 'q', so phases stop and cleanup still runs
function ask(q) {
	if (cfg.auto) return Promise.resolve('')
	if (inputClosed) return Promise.resolve('q')
	return new Promise((resolve) => {
		const onClose = () => resolve('q')
		rl.once('close', onClose)
		rl.question(q, (a) => {
			rl.removeListener('close', onClose)
			resolve(a.trim().toLowerCase())
		})
	})
}

// ---------- results ----------
const R = {
	started: stamp(),
	cfg: { ...cfg, password: cfg.password ? '(set)' : '' },
	frame: {},
	counts: {},
	preflight: [],
	naming: null,
	ready: null,
	steps: [],
	subscribe: null,
	xmlConnect: null,
	pktmon: null,
	notes: [],
}
let outDir = null
const events = [] // { t, kind: 'notify' | 'xml' | 'raw', ... }
const logFile = (name, line) => fs.appendFileSync(path.join(outDir, name), line + '\n')

// ---------- JSON-RPC ----------
function rpc(method, params = {}, timeoutMs = 5000) {
	if (cfg.operatorId) params = { ...params, operatorId: Number(cfg.operatorId) }
	else if (cfg.password) params = { ...params, password: cfg.password }
	const body = JSON.stringify({ jsonrpc: '2.0', id: '0', method, params })
	return new Promise((resolve, reject) => {
		const req = http.request(
			{
				host: cfg.frame,
				port: cfg.jsonPort,
				path: '/jsonrpc',
				method: 'POST',
				headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) },
				timeout: timeoutMs,
			},
			(res) => {
				let data = ''
				res.on('data', (c) => (data += c))
				res.on('end', () => {
					try {
						resolve(JSON.parse(data).result)
					} catch {
						reject(new Error(`${method}: unparseable reply (HTTP ${res.statusCode}): ${data.slice(0, 200)}`))
					}
				})
			},
		)
		req.on('timeout', () => req.destroy(new Error(`${method}: timed out after ${timeoutMs} ms`)))
		req.on('error', reject)
		req.end(body)
	})
}
const resp = async (method, params) => (await rpc(method, params))?.response

// ---------- frame model helpers ----------
const asArray = (v) => (Array.isArray(v) ? v : v == null ? [] : [v])
const isLiveInput = (s) => s.InputCfgIndex >= 0 && !(s.DestIndex >= 0) && !(s.UserKeyIndex >= 0)

async function snapshot() {
	const snap = { t: stamp(), errors: [] }
	const get = async (key, method, params) => {
		try {
			return await resp(method, params)
		} catch (err) {
			snap.errors.push(`${key}: ${err.message}`)
			return null
		}
	}
	snap.sources = await get('sources', 'listSources')
	snap.destinations = await get('destinations', 'listDestinations', { type: 0 })
	snap.content = {}
	for (const s of asArray(snap.destinations?.ScreenDestination))
		snap.content[s.id] = await get(`content ${s.id}`, 'listContent', { id: s.id })
	snap.auxContent = {}
	for (const a of asArray(snap.destinations?.AuxDestination))
		snap.auxContent[a.id] = await get(`auxContent ${a.id}`, 'listAuxContent', { id: a.id })
	snap.stills = await get('stills', 'listStill')
	return snap
}

// Flatten to path -> value, keying array elements by id where they have one, so diffs survive reordering.
function flatten(v, p = '', out = {}) {
	if (Array.isArray(v)) v.forEach((e, i) => flatten(e, `${p}[${e && e.id !== undefined ? '#' + e.id : i}]`, out))
	else if (v && typeof v === 'object') for (const k of Object.keys(v)) flatten(v[k], p ? `${p}.${k}` : k, out)
	else out[p] = v
	return out
}
function diff(a, b) {
	const strip = (s) => ({ ...s, t: undefined, errors: undefined })
	const fa = flatten(strip(a))
	const fb = flatten(strip(b))
	const out = []
	for (const k of new Set([...Object.keys(fa), ...Object.keys(fb)]))
		if (fa[k] !== fb[k]) out.push(`${k}: ${JSON.stringify(fa[k])} -> ${JSON.stringify(fb[k])}`)
	return out.sort()
}

// ---------- notification listener (raw TCP, minimal HTTP) ----------
let listener = null
function startListener() {
	return new Promise((resolve, reject) => {
		listener = net.createServer((sock) => {
			let buf = Buffer.alloc(0)
			let done = false
			const finish = () => {
				if (done) return
				done = true
				const text = buf.toString('utf8')
				const split = text.indexOf('\r\n\r\n')
				const bodyText = split >= 0 ? text.slice(split + 4) : text
				let parsed = null
				try {
					parsed = JSON.parse(bodyText)
				} catch {
					// keep raw
				}
				const n = parsed?.result || parsed?.params || parsed
				const ev = {
					t: stamp(),
					kind: 'notify',
					from: sock.remoteAddress,
					type: n?.notificationType || n?.type || parsed?.method || '(unparsed)',
					change: n?.change,
				}
				events.push(ev)
				logFile('notifications.jsonl', JSON.stringify({ ...ev, raw: text.slice(0, 4000) }))
				say(`  ${C.g}<< notification${C.x} ${ev.type} ${ev.change ? JSON.stringify(ev.change) : ''}`)
				try {
					sock.end('HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: 2\r\nConnection: close\r\n\r\nOK')
				} catch {
					// ignore
				}
			}
			sock.on('data', (c) => {
				buf = Buffer.concat([buf, c])
				const text = buf.toString('utf8')
				const split = text.indexOf('\r\n\r\n')
				if (split < 0) return
				const m = /content-length:\s*(\d+)/i.exec(text.slice(0, split))
				if (m && Buffer.byteLength(text.slice(split + 4)) >= Number(m[1])) finish()
			})
			sock.on('end', finish)
			sock.on('error', () => {})
			sock.setTimeout(5000, () => {
				finish()
				sock.destroy()
			})
		})
		listener.once('error', reject)
		listener.listen(cfg.port, '0.0.0.0', () => resolve())
	})
}

// ---------- passive 9876 socket ----------
let xmlSock = null
function openXml() {
	return new Promise((resolve) => {
		const s = net.connect({ host: cfg.frame, port: cfg.xmlPort })
		const t = setTimeout(() => {
			s.destroy()
			resolve(`connect timed out`)
		}, 4000)
		s.once('connect', () => {
			clearTimeout(t)
			xmlSock = s
			resolve('connected')
		})
		s.on('data', (d) => {
			const ev = { t: stamp(), kind: 'xml', bytes: d.length, text: d.toString('utf8') }
			events.push(ev)
			logFile('xml-9876.log', `--- ${ev.t} ${d.length} bytes\n${ev.text}\nHEX ${d.toString('hex')}`)
			say(`  ${C.g}<< 9876${C.x} ${d.length} bytes: ${ev.text.replace(/\s+/g, ' ').slice(0, 100)}`)
		})
		s.on('close', () => {
			if (xmlSock === s) {
				events.push({ t: stamp(), kind: 'xml-closed' })
				logFile('xml-9876.log', `--- ${stamp()} connection closed by frame`)
				say(`  ${C.y}9876 connection closed by the frame${C.x}`)
				xmlSock = null
			}
		})
		s.on('error', (err) => {
			clearTimeout(t)
			resolve(`error: ${err.message}`)
		})
	})
}

// ---------- pktmon ----------
let pktmonRunning = false
const pktmon = (...a) => execFileSync('pktmon', a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
function isAdmin() {
	if (process.platform !== 'win32') return false
	try {
		execFileSync('net', ['session'], { stdio: 'ignore' })
		return true
	} catch {
		return false
	}
}

// ---------- operator steps ----------
// need: what the frame must have for the step to make sense (from the readiness check)
function buildSteps(n) {
	const src = n.src1 ? `"${n.src1}"` : 'input source 1'
	const src2 = n.src2 ? `"${n.src2}"` : 'another input source'
	const scr = n.screen ? `"${n.screen}"` : 'the screen destination'
	const aux = n.aux ? `"${n.aux}"` : 'the aux destination'
	return [
		{
			id: 'A1',
			mock: 'renameScreen',
			need: ['screen'],
			control: 'ScreenDestChanged',
			text: `CONTROL: rename screen ${scr} (add an X to the end). Expected: ScreenDestChanged.`,
		},
		{ id: 'A2', mock: 'freezeSource', need: ['input'], text: `Freeze source ${src}.` },
		{ id: 'A3', mock: 'unfreezeSource', need: ['input'], text: `Unfreeze source ${src}.` },
		{ id: 'A4', mock: 'freezeScreen', need: ['screen'], text: `Freeze screen ${scr} (screen destination freeze).` },
		{ id: 'A5', mock: 'unfreezeScreen', need: ['screen'], text: `Unfreeze screen ${scr}.` },
		{
			id: 'A6',
			mock: 'recallPreset',
			need: ['presets'],
			text: `Recall preset "${n.preset1 || 'Preset 1'}" to PREVIEW (do not take).`,
		},
		{ id: 'A7', mock: 'take', need: ['screen'], text: `TAKE on ${scr} (Cut or Auto Trans).` },
		{
			id: 'A8',
			mock: 'changeLayerSource',
			need: ['layer'],
			text: `On ${scr} PREVIEW, change layer 1's source to ${src2}. Do not take.`,
		},
		{ id: 'A9', mock: 'take', need: ['screen'], text: `TAKE on ${scr} again.` },
		{ id: 'A10', mock: 'changeAuxSource', need: ['aux'], text: `Change ${aux}'s source (and take if it needs one).` },
		{ id: 'A11', mock: 'freezeAux', need: ['aux'], text: `Freeze aux ${aux}.` },
		{ id: 'A12', mock: 'unfreezeAux', need: ['aux'], text: `Unfreeze aux ${aux}.` },
		{
			id: 'A13',
			mock: 'renameSource',
			need: ['input'],
			text: `Rename source ${src} (add an X). Rename it back at the end if you like.`,
		},
		{
			id: 'A14',
			mock: 'changeInputCfg',
			need: ['input'],
			text: `Change an input config setting on ${src}'s input (e.g. contrast or cropping), then set it back.`,
		},
		{
			id: 'A15',
			mock: 'captureStill',
			need: ['input'],
			text: `Capture a still (from ${src}) or delete an existing still. Skip if stills aren't set up.`,
		},
		{
			id: 'A16',
			mock: 'changeBackground',
			need: ['screen'],
			text: `Change the background source on ${scr}. Skip if no backgrounds.`,
		},
		{ id: 'A17', mock: 'renameAux', need: ['aux'], text: `Rename aux ${aux} (add an X).` },
		{
			id: 'A18',
			mock: 'savePreset',
			need: ['screen'],
			control: 'PresetChanged',
			text: 'CONTROL: save a preset (new, or overwrite one). Expected: PresetChanged.',
		},
		{
			id: 'A19',
			mock: 'renameScreenBack',
			need: ['screen'],
			control: 'ScreenDestChanged',
			text: `CONTROL: rename the screen back to ${scr} (remove the X). Expected: ScreenDestChanged.`,
		},
	]
}

async function mockDo(action) {
	if (!cfg.mockControl) return
	const u = new URL(cfg.mockControl)
	const body = JSON.stringify({ action })
	await new Promise((r) => {
		const req = http.request({ host: u.hostname, port: u.port, path: u.pathname, method: 'POST' }, (res) => {
			res.resume()
			res.on('end', r)
		})
		req.on('error', r)
		req.end(body)
	})
}

async function runSteps(steps, have) {
	let prev = await snapshot()
	let lastTo = Date.now()
	fs.writeFileSync(path.join(outDir, 'snapshots', `00-baseline.json`), JSON.stringify(prev, null, 2))
	for (let i = 0; i < steps.length; i++) {
		const st = steps[i]
		const missing = st.need.filter((k) => !have[k])
		const rec = { id: st.id, text: st.text, control: st.control }
		R.steps.push(rec)
		say(`\n${C.b}[${st.id}] ${i + 1}/${steps.length}${C.x}  ${st.text}`)
		if (missing.length) {
			rec.status = `skipped: frame has no ${missing.join(', ')}`
			warn(rec.status)
			continue
		}
		// Window runs from the end of the previous step, so nothing arriving between steps is lost
		const from = lastTo
		const a = await ask(`  Do it in EMT, then press Enter.  (s = skip, q = stop this phase) > `)
		if (a === 'q') {
			rec.status = 'not run (phase stopped)'
			for (const rest of steps.slice(i + 1))
				R.steps.push({ id: rest.id, text: rest.text, status: 'not run (phase stopped)' })
			break
		}
		if (a === 's') {
			rec.status = 'skipped by operator'
			lastTo = Date.now()
			continue
		}
		await mockDo(st.mock)
		await wait(cfg.settleMs)
		const to = Date.now()
		lastTo = to
		const inWindow = events.filter((e) => Date.parse(e.t) >= from && Date.parse(e.t) <= to)
		rec.status = 'done'
		rec.notify = inWindow.filter((e) => e.kind === 'notify').map((e) => ({ type: e.type, change: e.change }))
		rec.xml = inWindow.filter((e) => e.kind === 'xml')
		rec.xmlClosed = inWindow.some((e) => e.kind === 'xml-closed')
		const snap = await snapshot()
		fs.writeFileSync(
			path.join(outDir, 'snapshots', `${String(i + 1).padStart(2, '0')}-${st.id}.json`),
			JSON.stringify(snap, null, 2),
		)
		rec.diff = diff(prev, snap)
		rec.snapErrors = snap.errors
		prev = snap
		const types = [...new Set(rec.notify.map((n) => n.type))]
		say(
			`  -> notifications: ${types.length ? types.join(', ') : 'none'};  9876: ${rec.xml.length ? rec.xml.reduce((s, e) => s + e.bytes, 0) + ' bytes' : 'nothing'};  state changes: ${rec.diff.length}`,
		)
		for (const d of rec.diff.slice(0, 6)) say(`       ${d}`)
		if (rec.diff.length > 6) say(`       ... ${rec.diff.length - 6} more (see results.md)`)
		if (st.control && !types.includes(st.control)) {
			bad(`Control step: expected ${st.control} but it did not arrive.`)
			if (st.id === 'A1') {
				say('    The frame is not reaching the listener. Usual causes: network profile Public, firewall rule')
				say(`    missing for TCP ${cfg.port}, wrong --local IP, or the subscribe failed (see above).`)
				const c = await ask('  Continue anyway (still records 9876 and state diffs)? [y/N] > ')
				if (c !== 'y' && !cfg.auto) {
					R.notes.push('Stopped after A1: control notification did not arrive.')
					break
				}
			}
		} else if (st.control) ok(`Control notification ${st.control} arrived: listener path works.`)
	}
}

// ---------- phases ----------
let names = {}
let have = {}
let sourcesCache = null
let destsCache = null

async function phaseId() {
	head('Frame identification (read-only)')
	try {
		const fsRes = await rpc('getFrameSettings', {})
		const frame = asArray(fsRes?.response?.System?.FrameCollection?.Frame)[0] || {}
		const scalars = {}
		for (const [k, v] of Object.entries(frame)) if (v === null || typeof v !== 'object') scalars[k] = v
		R.frame = {
			model: frame.FrameTypeName || frame.FrameType || frame.Model || frame.Name || 'unknown',
			name: frame.Name,
			version: frame.Version,
			osVersion: frame.OSVersion,
			mac: frame.Enet?.MacAddress,
			ip: frame.Enet?.IP,
			scalars,
		}
		fs.writeFileSync(path.join(outDir, 'frame-settings.json'), JSON.stringify(fsRes, null, 2))
		ok(
			`Frame ${R.frame.model} "${R.frame.name ?? ''}", version ${R.frame.version}, OS ${R.frame.osVersion}, MAC ${R.frame.mac}`,
		)
		if (!String(R.frame.version || '').startsWith('9.'))
			warn('Firmware is not 9.x: results may not match the first frame (9.2).')
	} catch (err) {
		bad(`getFrameSettings failed: ${err.message}`)
		R.frame = { error: err.message }
	}
	await loadLists()
}

async function loadLists() {
	try {
		sourcesCache = asArray(await resp('listSources'))
		destsCache = (await resp('listDestinations', { type: 0 })) || {}
		const presets = asArray(await resp('listPresets', { ScreenDest: -1, AuxDest: -1 }))
		const stills = asArray(await resp('listStill').catch(() => null))
		R.counts = {
			sources: sourcesCache.length,
			liveInputs: sourcesCache.filter(isLiveInput).length,
			screens: asArray(destsCache.ScreenDestination).length,
			auxes: asArray(destsCache.AuxDestination).length,
			presets: presets.length,
			stills: stills.length,
		}
		R.presets = presets.map((p) => p.Name)
		ok(
			`Counts: ${Object.entries(R.counts)
				.map(([k, v]) => `${k} ${v}`)
				.join(', ')}`,
		)
	} catch (err) {
		bad(`Listing failed: ${err.message}`)
		R.counts = { error: err.message }
	}
}

async function phasePreflight() {
	head('Preflight (no frame changes)')
	const add = (name, pass, detail, level) => {
		R.preflight.push({ name, result: pass ? 'OK' : level || 'FAIL', detail })
		;(pass ? ok : level === 'WARN' ? warn : bad)(`${name}: ${detail}`)
	}
	// local IP on the frame's subnet
	const ifs = Object.values(os.networkInterfaces())
		.flat()
		.filter((i) => i && i.family === 'IPv4')
	const mine = ifs.find((i) => i.address === cfg.local)
	const prefix = cfg.frame.split('.').slice(0, 3).join('.') + '.'
	const onSubnet = ifs.find((i) => i.address.startsWith(prefix))
	if (cfg.frame === '127.0.0.1') add('Local IP', true, `rehearsal on loopback, using ${cfg.local}`)
	else if (mine && cfg.local.startsWith(prefix))
		add('Local IP', true, `${cfg.local} is on this PC and on the frame's /24`)
	else if (onSubnet) {
		add('Local IP', false, `${cfg.local} is not usable; using ${onSubnet.address} (on the frame's /24) instead`, 'WARN')
		cfg.local = onSubnet.address
	} else add('Local IP', false, `no interface on ${prefix}x. Frame cannot reach this PC for notifications.`)
	// JSON reachable
	try {
		await rpc('listSources', {}, 4000)
		add('JSON-RPC 9999', true, 'frame answers')
	} catch (err) {
		add('JSON-RPC 9999', false, err.message)
	}
	// 9876 TCP connect only
	const r = await new Promise((resolve) => {
		const s = net.connect({ host: cfg.frame, port: cfg.xmlPort })
		const t = setTimeout(() => (s.destroy(), resolve('timed out')), 3000)
		s.once('connect', () => (clearTimeout(t), s.destroy(), resolve('ok')))
		s.once('error', (e) => (clearTimeout(t), resolve(e.message)))
	})
	add(`XML TCP ${cfg.xmlPort}`, r === 'ok', r === 'ok' ? 'connects' : r, 'WARN')
	// local port free
	const free = await new Promise((resolve) => {
		const s = net
			.createServer()
			.once('error', (e) => resolve(e.code))
			.once('listening', () => s.close(() => resolve('free')))
		s.listen(cfg.port, '0.0.0.0')
	})
	add(
		`Listener port ${cfg.port}`,
		free === 'free',
		free === 'free'
			? 'free'
			: `${free}: is Companion's Event Master connection still enabled? Disable it for the test.`,
	)
	say(`\n  ${C.y}Reminder: the Companion Event Master connection must be DISABLED while the kit runs.${C.x}`)
}

function phaseNaming() {
	head('Naming and filter checks (read-only)')
	if (!sourcesCache) return warn('No source list (identification failed); skipped.')
	const live = sourcesCache.filter(isLiveInput)
	const noSuffix = live.filter((s) => !/-\d+$/.test(s.Name || ''))
	const reentry = sourcesCache.filter((s) => s.DestIndex >= 0 || s.UserKeyIndex >= 0)
	R.naming = {
		sources: sourcesCache.map((s) => ({
			id: s.id,
			Name: s.Name,
			InputCfgIndex: s.InputCfgIndex,
			StillIndex: s.StillIndex,
			DestIndex: s.DestIndex,
			UserKeyIndex: s.UserKeyIndex,
			Freeze: s.Freeze,
			liveInput: isLiveInput(s),
		})),
		noSuffix: noSuffix.map((s) => s.Name),
		reentry: reentry.map((s) => s.Name),
	}
	if (noSuffix.length) warn(`Live inputs NOT ending in -<digits>: ${noSuffix.map((s) => `"${s.Name}"`).join(', ')}`)
	else if (live.length) ok(`All ${live.length} live input names end in -<digits> (label rule holds)`)
	if (reentry.length)
		ok(`Excluded by the filter (DestIndex/UserKeyIndex >= 0): ${reentry.map((s) => `"${s.Name}"`).join(', ')}`)
	else warn('No re-entry or user-key sources on this frame: the DestIndex filter is not exercised.')
	for (const s of live) say(`    live input: id ${s.id} "${s.Name}" InputCfgIndex ${s.InputCfgIndex}`)
}

async function phaseReady() {
	head('Readiness check (against FRAME-PREP.md)')
	if (!sourcesCache) return bad('No frame data; cannot check readiness.')
	const live = sourcesCache.filter(isLiveInput)
	const screens = asArray(destsCache?.ScreenDestination)
	const auxes = asArray(destsCache?.AuxDestination)
	let layers = 0
	if (screens[0]) {
		try {
			layers = asArray((await resp('listContent', { id: screens[0].id }))?.Layers).length
		} catch {
			// counted as 0
		}
	}
	names = {
		src1: live[0]?.Name,
		src2: live[1]?.Name,
		screen: screens[0]?.Name,
		aux: auxes[0]?.Name,
		preset1: R.presets?.[0],
	}
	have = {
		input: live.length >= 1,
		screen: screens.length >= 1,
		layer: layers >= 1,
		aux: auxes.length >= 1,
		presets: (R.counts.presets || 0) >= 1,
	}
	const items = [
		['2 live input sources', live.length >= 2, `${live.length} found`, live.length >= 1],
		['1 screen destination', screens.length >= 1, `${screens.length} found`],
		['2 layers on the first screen', layers >= 2, `${layers} layer entries in listContent`, layers >= 1],
		['1 aux destination', auxes.length >= 1, `${auxes.length} found`],
		['2 presets', (R.counts.presets || 0) >= 2, `${R.counts.presets || 0} found`, (R.counts.presets || 0) >= 1],
		['Screen re-entered as a source (optional)', (R.naming?.reentry || []).length > 0, 'optional', true],
	]
	R.ready = items.map(([name, pass, detail, partial]) => ({ name, pass, detail, partial: !!partial }))
	for (const it of R.ready) (it.pass ? ok : it.partial ? warn : bad)(`${it.name}: ${it.detail}`)
	const missing = R.ready.filter((i) => !i.pass && !i.partial)
	if (missing.length)
		say(`\n  ${C.y}Missing: ${missing.map((m) => m.name).join('; ')}. Steps that need these will be skipped.${C.x}`)
	else say(`\n  ${C.g}Frame is ready.${C.x}`)
}

let live = false
async function startLive() {
	if (live) return true
	try {
		await startListener()
		ok(`Listening on 0.0.0.0:${cfg.port}`)
	} catch (err) {
		R.notes.push(`Listener failed: ${err.message}`)
		bad(`Cannot listen on ${cfg.port}: ${err.message}. Disable the Companion EM connection and rerun.`)
		return false
	}
	R.xmlConnect = await openXml()
	;(R.xmlConnect === 'connected' ? ok : warn)(`9876 passive socket: ${R.xmlConnect} (sending nothing)`)
	try {
		await rpc('unsubscribe', { hostname: cfg.local, port: String(cfg.port), notification: NOTIFICATION_TYPES })
	} catch {
		// a leftover subscription from an aborted run may or may not exist
	}
	try {
		const res = await rpc('subscribe', {
			hostname: cfg.local,
			port: String(cfg.port),
			notification: NOTIFICATION_TYPES,
		})
		R.subscribe = res
		subscribed = true
		;(res?.success === 0 ? ok : warn)(
			`subscribe ${cfg.local}:${cfg.port} all ${NOTIFICATION_TYPES.length} types -> ${JSON.stringify(res)}`,
		)
	} catch (err) {
		R.subscribe = { error: err.message }
		bad(`subscribe failed: ${err.message}`)
	}
	live = true
	return true
}

// Optional: listener on while the operator programs the frame, so setup doubles as a positive control
async function phasePrep() {
	head('Prep: program the frame with the listener on')
	if (!(await startLive())) return
	say('  Program the frame now, following FRAME-PREP.md. Every notification is logged as you go.')
	say('  If the frame is already programmed, just press Enter.')
	const from = Date.now()
	await ask('  Press Enter when the frame is programmed. > ')
	const got = events.filter((e) => Date.parse(e.t) >= from)
	R.prep = {
		notify: got.filter((e) => e.kind === 'notify').map((e) => ({ t: e.t, type: e.type, change: e.change })),
		xmlBytes: got.filter((e) => e.kind === 'xml').reduce((a, e) => a + e.bytes, 0),
	}
	const types = [...new Set(R.prep.notify.map((n) => n.type))]
	say(`  -> ${R.prep.notify.length} notification(s): ${types.join(', ') || 'none'}; 9876: ${R.prep.xmlBytes} bytes`)
	if (R.prep.notify.length) ok('The frame reaches the listener: the network path works.')
	say('  Re-reading the frame...')
	await loadLists()
}

async function phaseA() {
	head('Phase A: JSON notifications + passive XML 9876 + state diffs')
	if (!sourcesCache) return bad('No frame data; skipped.')
	if (!(await startLive())) return
	let steps = buildSteps(names)
	if (cfg.steps) {
		const want = cfg.steps.split(',')
		steps = steps.filter((s) => want.includes(s.id))
	}
	say(
		`\n  ${steps.length} steps. Each: do it in EMT, press Enter, the kit waits ${cfg.settleMs / 1000} s and reads state.`,
	)
	await runSteps(steps, have)
}

async function phaseC() {
	head('Phase C: EMT traffic capture (pktmon)')
	if (cfg.noPktmon || cfg.auto) {
		R.pktmon = 'skipped (rehearsal / --no-pktmon)'
		return warn(R.pktmon)
	}
	if (!isAdmin()) {
		R.pktmon = 'skipped: not running as Administrator'
		return warn(`${R.pktmon}. Rerun with: .\\Run-FrameTests.ps1 -Phases C (from an admin PowerShell)`)
	}
	const go = await ask('  Is EMT installed on THIS PC and can you run it now? [Y/n] > ')
	if (go === 'n') {
		R.pktmon = 'skipped: EMT not on this PC (see README for capturing on another machine)'
		return warn(R.pktmon)
	}
	const etl = path.join(outDir, 'emt-capture.etl')
	const steps = []
	try {
		await ask('  1. CLOSE EMT if it is open, then press Enter. > ')
		try {
			pktmon('stop')
		} catch {
			// not running
		}
		pktmon('filter', 'remove')
		pktmon('filter', 'add', 'EventMaster', '-i', cfg.frame)
		pktmon('start', '--capture', '--comp', 'nics', '--pkt-size', '0', '--file-name', etl)
		pktmonRunning = true
		ok(`pktmon capturing all traffic to/from ${cfg.frame}`)
		const prompts = [
			'2. Open EMT and connect to the frame. Wait until the show has loaded. Then press Ctrl+O to open its XML log.',
			'3. From a DIFFERENT client (Companion button, a second EMT, or the front panel), freeze a source, then unfreeze it. Watch whether THIS EMT updates.',
			'4. From the different client, TAKE on the screen. Watch whether THIS EMT updates.',
			'5. From THIS EMT, freeze a source, then unfreeze it (captures what EMT sends).',
			`6. Save EMT's Ctrl+O XML log into ${outDir} (any name). Then close EMT.`,
		]
		for (const p of prompts) {
			const a = await ask(`  ${p}\n     Enter when done (s = skip) > `)
			steps.push({ step: p, status: a === 's' ? 'skipped' : 'done', t: stamp() })
		}
		const upd = await ask('  Did THIS EMT update on its own in steps 3 and 4? [y/n/unsure] > ')
		R.pktmonEmtUpdated = upd || 'not answered'
	} catch (err) {
		bad(`pktmon: ${err.message}`)
		R.notes.push(`pktmon error: ${err.message}`)
	} finally {
		stopPktmon()
	}
	R.pktmon = { etl, steps }
	try {
		pktmon('etl2pcap', etl, '--out', path.join(outDir, 'emt-capture.pcapng'))
		ok('Converted to emt-capture.pcapng (open in Wireshark)')
		R.pktmon.pcap = 'emt-capture.pcapng'
	} catch (err) {
		warn(`etl2pcap failed: ${err.message}`)
	}
}

function stopPktmon() {
	if (!pktmonRunning) return
	try {
		pktmon('stop')
		pktmon('filter', 'remove')
		ok('pktmon stopped')
	} catch (err) {
		warn(`pktmon stop: ${err.message}`)
	}
	pktmonRunning = false
}

// ---------- cleanup and report ----------
let subscribed = false
let cleaned = false
async function cleanup() {
	if (cleaned) return
	cleaned = true
	head('Cleanup')
	stopPktmon()
	if (subscribed) {
		try {
			const r = await rpc(
				'unsubscribe',
				{ hostname: cfg.local, port: String(cfg.port), notification: NOTIFICATION_TYPES },
				3000,
			)
			ok(`unsubscribed ${cfg.local}:${cfg.port} -> ${JSON.stringify(r)}`)
		} catch (err) {
			warn(`unsubscribe failed: ${err.message} (the frame drops it on restart)`)
		}
	}
	if (xmlSock) {
		const s = xmlSock
		xmlSock = null
		s.destroy()
	}
	if (listener) await new Promise((r) => listener.close(() => r()))
	if (outDir) {
		fs.writeFileSync(path.join(outDir, 'results.json'), JSON.stringify(R, null, 2))
		fs.writeFileSync(path.join(outDir, 'results.md'), report())
		ok(`Results: ${outDir}`)
	}
}

function report() {
	const L = []
	const md = (s) =>
		String(s ?? '')
			.replace(/\|/g, '\\|')
			.replace(/\r?\n/g, ' ')
	L.push(`# Frame test results`, '')
	L.push(`Run ${R.started} to ${stamp()}. Frame ${cfg.frame}, listener ${cfg.local}:${cfg.port}.`, '')
	L.push('## Frame', '')
	L.push('| Field | Value |', '| --- | --- |')
	for (const [k, v] of Object.entries(R.frame.scalars || R.frame)) L.push(`| ${md(k)} | ${md(v)} |`)
	if (R.frame.mac) L.push(`| MAC | ${md(R.frame.mac)} |`)
	L.push(
		'',
		`Counts: ${Object.entries(R.counts)
			.map(([k, v]) => `${k} ${v}`)
			.join(', ')}`,
		'',
	)
	if (R.windows) {
		L.push('## Windows network (from Run-FrameTests.ps1)', '')
		for (const n of [].concat(R.windows)) L.push(`- ${md(n)}`)
		L.push('')
	}
	if (R.preflight.length) {
		L.push('## Preflight', '', '| Check | Result | Detail |', '| --- | --- | --- |')
		for (const p of R.preflight) L.push(`| ${md(p.name)} | ${p.result} | ${md(p.detail)} |`)
		L.push('')
	}
	if (R.ready) {
		L.push('## Readiness', '', '| Item | Result | Detail |', '| --- | --- | --- |')
		for (const r of R.ready)
			L.push(`| ${md(r.name)} | ${r.pass ? 'OK' : r.partial ? 'partial' : 'MISSING'} | ${md(r.detail)} |`)
		L.push('')
	}
	if (R.naming) {
		L.push('## Naming and filter', '')
		L.push(`- Live inputs not ending in -<digits>: ${R.naming.noSuffix.length ? R.naming.noSuffix.join(', ') : 'none'}`)
		L.push(
			`- Excluded by DestIndex/UserKeyIndex filter: ${R.naming.reentry.length ? R.naming.reentry.join(', ') : 'none on this frame'}`,
		)
		L.push('', '| id | Name | InputCfgIndex | StillIndex | DestIndex | UserKeyIndex | Freeze | live input |')
		L.push('| --- | --- | --- | --- | --- | --- | --- | --- |')
		for (const s of R.naming.sources)
			L.push(
				`| ${s.id} | ${md(s.Name)} | ${s.InputCfgIndex} | ${s.StillIndex} | ${s.DestIndex} | ${s.UserKeyIndex} | ${s.Freeze} | ${s.liveInput ? 'yes' : 'no'} |`,
			)
		L.push('')
	}
	if (R.prep) {
		L.push('## Prep (listener on while programming)', '')
		L.push(`9876 bytes during prep: ${R.prep.xmlBytes}`, '')
		for (const n of R.prep.notify) L.push(`- ${n.t} ${n.type} ${JSON.stringify(n.change)}`)
		if (!R.prep.notify.length) L.push('- no notifications')
		L.push('')
	}
	if (R.steps.length) {
		L.push('## Phase A: action x notification matrix', '')
		L.push(`Subscribe result: \`${JSON.stringify(R.subscribe)}\`. 9876 passive socket: ${R.xmlConnect}.`, '')
		const short = NOTIFICATION_TYPES.map((t) => t.replace('Changed', ''))
		L.push(`| Step | Action | Status | ${short.join(' | ')} | 9876 bytes | State changes |`)
		L.push(`| --- | --- | --- | ${short.map(() => '---').join(' | ')} | --- | --- |`)
		for (const s of R.steps) {
			const cells = NOTIFICATION_TYPES.map((t) => {
				const n = (s.notify || []).filter((x) => x.type === t).length
				return n ? `**${n}**` : s.status === 'done' ? '.' : ''
			})
			const xb = (s.xml || []).reduce((a, e) => a + e.bytes, 0)
			L.push(
				`| ${s.id} | ${md(s.text).slice(0, 70)} | ${md(s.status)} | ${cells.join(' | ')} | ${s.status === 'done' ? (xb ? `**${xb}**` : '0') : ''} | ${s.diff ? s.diff.length : ''} |`,
			)
		}
		const other = R.steps.flatMap((s) => (s.notify || []).filter((n) => !NOTIFICATION_TYPES.includes(n.type)))
		if (other.length)
			L.push('', `Unrecognised notification types: ${[...new Set(other.map((o) => o.type))].join(', ')}`)
		L.push('', '### Step details', '')
		for (const s of R.steps) {
			if (s.status !== 'done') continue
			L.push(`#### ${s.id}: ${s.text}`, '')
			L.push(
				`- Notifications: ${s.notify.length ? s.notify.map((n) => `${n.type} ${JSON.stringify(n.change)}`).join('; ') : 'none'}`,
			)
			L.push(
				`- 9876: ${s.xml.length ? `${s.xml.length} chunk(s)` : 'nothing'}${s.xmlClosed ? ' (frame closed the connection)' : ''}`,
			)
			for (const x of s.xml.slice(0, 3)) L.push('', '```xml', x.text.slice(0, 1500), '```')
			if (s.snapErrors?.length) L.push(`- Snapshot errors: ${s.snapErrors.join('; ')}`)
			L.push(`- State changes (${s.diff.length}):`)
			for (const d of s.diff.slice(0, 40)) L.push(`  - \`${d}\``)
			if (s.diff.length > 40) L.push(`  - ... ${s.diff.length - 40} more in snapshots/`)
			L.push('')
		}
	}
	if (R.pktmon) {
		L.push('## Phase C: EMT capture', '')
		L.push(typeof R.pktmon === 'string' ? R.pktmon : `Capture: ${R.pktmon.pcap || R.pktmon.etl}`)
		if (R.pktmonEmtUpdated)
			L.push('', `Operator: EMT updated on its own when another client froze/took: **${R.pktmonEmtUpdated}**`)
		for (const s of R.pktmon.steps || []) L.push(`- ${s.status}: ${s.step}`)
		L.push('')
	}
	if (R.notes.length) L.push('## Notes', '', ...R.notes.map((n) => `- ${n}`), '')
	return L.join('\n')
}

// ---------- main ----------
async function main() {
	rl = readline.createInterface({ input: process.stdin, output: process.stdout })
	rl.on('close', () => (inputClosed = true))
	rl.on('SIGINT', () => process.emit('SIGINT'))
	let interrupted = false
	process.on('SIGINT', async () => {
		if (interrupted) process.exit(130)
		interrupted = true
		say(`\n${C.y}Interrupted: cleaning up...${C.x}`)
		R.notes.push('Run interrupted with Ctrl+C.')
		await cleanup()
		process.exit(130)
	})

	say(
		`${C.b}Event Master frame test kit${C.x}  frame ${cfg.frame}  listener ${cfg.local}:${cfg.port}  phases ${cfg.phases.join(',')}`,
	)
	say('This kit changes nothing on the frame. You make every change in EMT when asked.')
	if (cfg.wrapperNotes) {
		try {
			R.windows = JSON.parse(fs.readFileSync(cfg.wrapperNotes, 'utf8').replace(/^\uFEFF/, ''))
		} catch (err) {
			R.notes.push(`Could not read wrapper notes: ${err.message}`)
		}
	}

	const tmp = path.join(cfg.out, `_run-${Date.now()}`)
	fs.mkdirSync(path.join(tmp, 'snapshots'), { recursive: true })
	outDir = tmp

	// Identification always runs: steps and the readiness check need the frame's lists.
	await phaseId()
	const safe = (s) => String(s || 'unknown').replace(/[^\w.-]+/g, '_')
	const ts = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19)
	const final = path.join(cfg.out, `${safe(R.frame.model)}_${safe(R.frame.version)}_${ts}`)
	try {
		fs.renameSync(tmp, final)
		outDir = final
	} catch {
		// keep the temp name
	}

	const want = (p) => cfg.phases.includes(p)
	if (want('preflight')) await phasePreflight()
	if (want('prep')) await phasePrep()
	if (want('naming') || want('ready') || want('A')) phaseNaming()
	if (want('ready') || want('A')) await phaseReady()
	if (want('A') || want('B')) {
		const go = await ask('\nReady to start Phase A? Have EMT open and connected. [Enter] > ')
		if (go !== 'q') await phaseA()
	}
	if (want('C')) await phaseC()
	await cleanup()
	rl.close()
	say(`\n${C.b}Done.${C.x} Send back the whole folder: ${outDir}`)
}

main().catch(async (err) => {
	console.error(`\nKit error: ${err.stack || err}`)
	R.notes.push(`Kit error: ${err.message}`)
	await cleanup()
	process.exit(1)
})
