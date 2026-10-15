// Module check: runs this repo's module code against a real frame and reports whether it answers
// back sensibly. For trying the module on a different frame model (e.g. a PDS-4K).
//
// Run from the repo checkout (it loads ../eventmaster.js and ../node_modules), with Companion's node18
// so the existing firewall rule for that node.exe applies:
//   & "C:\Program Files\Companion\resources\node-runtimes\node18\node.exe" frame-test-kit\module-check.js --frame 192.168.0.175
//
//   --frame IP      frame address (required)
//   --local IP      this PC's address for notifications (default: auto, the interface on the frame's /24)
//   --port N        local notification port (default 3005, so a running Companion on 3000 is unaffected)
//   --changes       also freeze/unfreeze, arm/unarm and test pattern on/off, each put back as found.
//                   Without it the check is read-only (plus subscribe/unsubscribe).
'use strict'
/* eslint-disable n/no-process-exit -- standalone CLI */
const Module = require('module')
const http = require('http')
const fs = require('fs')
const path = require('path')

const argv = process.argv.slice(2)
const arg = (n, d) => {
	const i = argv.indexOf(n)
	return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : d
}
const FRAME = arg('--frame', '')
const LOCAL = arg('--local', '')
const PORT = Number(arg('--port', 3005))
const CHANGES = argv.includes('--changes')
const REPO = path.resolve(__dirname, '..')
const OUT_DIR = path.join(__dirname, 'results')
if (!FRAME) {
	console.log('Usage: module-check.js --frame <ip> [--local <ip>] [--port 3005] [--changes]')
	process.exit(1)
}

// ---------- minimal stand-in for Companion's module host ----------
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
				this.logs.push([l, m, Date.now()])
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
			updateStatus(s, m) {
				this.status = m || s
			}
		}
		return {
			InstanceBase,
			InstanceStatus: {
				Ok: 'ok',
				ConnectionFailure: 'connection_failure',
				Connecting: 'connecting',
				UnknownWarning: 'warning',
			},
			Regex: { IP: '' },
			runEntrypoint: (c) => (Captured = c),
			combineRgb: (r, g, b) => (r << 16) + (g << 8) + b,
		}
	}
	return origLoad.apply(this, arguments)
}

// ---------- helpers ----------
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const until = async (fn, ms) => {
	const t = Date.now()
	while (Date.now() - t < ms) {
		if (fn()) return Date.now() - t
		await wait(20)
	}
	return -1
}
const rpcRaw = (method, params) =>
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
		req.on('error', (e) => resolve(JSON.stringify({ transportError: e.message })))
		req.end(JSON.stringify({ jsonrpc: '2.0', id: '0', method, params }))
	})
const rpc = async (method, params) => {
	try {
		return JSON.parse(await rpcRaw(method, params))
	} catch {
		return { unparsed: true }
	}
}
const report = []
const say = (s = '') => {
	console.log(s)
	report.push(s)
}
let fails = 0
const check = (label, ok, detail = '') => {
	say(`${ok ? 'OK  ' : 'FAIL'}  ${label}${detail ? ` (${detail})` : ''}`)
	if (!ok) fails++
}
const note = (label, detail) => say(`INFO  ${label}${detail !== undefined ? `: ${detail}` : ''}`)
let inst = null // module instance, so the error path can still unsubscribe
const keysOf = (o) => (o && typeof o === 'object' ? Object.keys(o).join(', ') : String(o))

;(async () => {
	say(`Module check against ${FRAME}  ${new Date().toISOString()}  ${CHANGES ? '(with changes)' : '(read-only)'}`)

	// ---------- 1. What the frame says it is, and the shapes the module depends on ----------
	say('\n== Frame and data shapes ==')
	const fsr = await rpc('getFrameSettings', {})
	if (fsr.transportError) {
		check('frame answers JSON-RPC on 9999', false, fsr.transportError)
		process.exit(1)
	}
	const frame = [].concat(fsr.result?.response?.System?.FrameCollection?.Frame ?? [])[0] || {}
	note('model', `${frame.FrameTypeName ?? frame.FrameType ?? '?'} ("${frame.Name ?? ''}")`)
	note('firmware', `${frame.Version ?? '?'}, OS ${frame.OSVersion ?? '?'}`)

	const src = (await rpc('listSources', {})).result?.response || []
	const live = src.filter((s) => s.InputCfgIndex >= 0 && !(s.DestIndex >= 0) && !(s.UserKeyIndex >= 0))
	note('sources', `${src.length} (${live.length} live inputs)`)
	if (live[0]) {
		note('source fields', keysOf(live[0]))
		check('source has Freeze', live[0].Freeze !== undefined)
		check(
			'source has InputCfgVideoStatus (signal)',
			live[0].InputCfgVideoStatus !== undefined,
			`value ${live[0].InputCfgVideoStatus}`,
		)
	}
	const dests = (await rpc('listDestinations', { type: 0 })).result?.response || {}
	const screens = [].concat(dests.ScreenDestination ?? [])
	const auxes = [].concat(dests.AuxDestination ?? [])
	note('screens / auxes', `${screens.length} / ${auxes.length}`)
	if (screens[0]) {
		note('screen fields', keysOf(screens[0]))
		const shape =
			screens[0].DestOutMapCol !== undefined
				? 'DestOutMapCol (9.2.6318 shape)'
				: screens[0].DestOutMapColl !== undefined
					? 'DestOutMapColl (8.2 doc shape)'
					: 'NEITHER'
		const outs = []
			.concat(screens[0].DestOutMapCol ?? screens[0].DestOutMapColl ?? [])
			.flatMap((c) => [].concat(c?.DestOutMap ?? []))
		const fld = outs[0]?.FrzMode !== undefined ? 'FrzMode' : outs[0]?.Freeze !== undefined ? 'Freeze' : 'NONE'
		check(
			'screen output freeze readable',
			shape !== 'NEITHER' && fld !== 'NONE',
			`${shape}, field ${fld}, ${outs.length} output(s)`,
		)
		const c0 = (await rpc('listContent', { id: screens[0].id })).result?.response || {}
		check('screen content has IsActive (armed)', c0.IsActive !== undefined, `value ${c0.IsActive}`)
		const tp = []
			.concat(c0.OutputCfg ?? [])
			.flatMap((o) => [].concat(o?.OutputAOI ?? []))
			.flatMap((a) => [].concat(a?.TestPattern ?? []))
		check(
			'screen content has TestPatternMode',
			tp.length > 0,
			tp.length ? `value ${tp[0].TestPatternMode}` : 'no OutputCfg test pattern',
		)
		note('screen layers', [].concat(c0.Layers ?? []).length)
	}
	if (auxes[0]) note('aux fields', keysOf(auxes[0]))
	const pw = await rpc('powerStatus', {})
	note('powerStatus reply', JSON.stringify(pw.error ?? pw.result ?? pw).slice(0, 200))

	// ---------- 2. The module itself ----------
	say('\n== Module ==')
	require(path.join(REPO, 'eventmaster.js'))
	const EventMaster = require(path.join(REPO, 'node_modules', 'barco-eventmaster'))
	inst = new Captured({})
	inst.config = { host: FRAME, pollingInterval: 15, enable_notifications: true, notification_port: PORT }
	if (LOCAL) inst.config.notification_host = LOCAL
	inst.previousVariableValues = {}
	inst.frameVariableDefinitions = []
	inst.CHOICES_TESTPATTERN = [
		{ label: 'Off', id: '0' },
		{ label: '100% Color Bars', id: '3' },
	]
	inst.CHOICES_FREEZE = []
	inst.powerStatus = ['not present', 'no AC', 'no DC', 'OK']
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
	inst.eventmaster = new EventMaster(FRAME)
	inst.notificationPort = PORT
	await inst.getAllDataFromEventmaster()
	inst.refreshDefinitions()
	await wait(1500)
	const cats = {}
	for (const p of Object.values(inst.presets || {})) cats[p.category] = (cats[p.category] || 0) + 1
	note(
		'preset categories',
		Object.entries(cats)
			.map(([c, n]) => `${c} (${n})`)
			.join('; '),
	)
	note(
		'frame variables',
		`frame_version ${inst.vars.frame_version}, power ${inst.vars.power_status1} / ${inst.vars.power_status2}`,
	)
	for (const s of live.slice(0, 4))
		note(
			`source ${s.id + 1} "${s.Name}"`,
			`frozen ${inst.vars[`source_${s.id + 1}_frozen`]}, signal ${inst.vars[`source_${s.id + 1}_signal`]}, label "${inst.vars[`source_${s.id + 1}_label`]}"`,
		)
	for (const s of screens.slice(0, 4))
		note(
			`screen ${s.id} "${s.Name}"`,
			`frozen ${inst.vars[`screen_${s.id}_frozen`]}, armed ${inst.vars[`screen_${s.id}_armed`]}, test pattern ${inst.vars[`screen_${s.id}_test_pattern`]}`,
		)
	for (const a of auxes.slice(0, 4))
		note(
			`aux ${a.id} "${a.Name}"`,
			`frozen ${inst.vars[`aux_${a.id}_frozen`]}, test pattern ${inst.vars[`aux_${a.id}_test_pattern`]}`,
		)

	// Live updates
	await inst.setupNotifications()
	const subMs = await until(() => /Subscribed|failed|Error/.test(inst.vars.live_updates_status || ''), 5000)
	check(
		'subscribe accepted',
		inst.vars.live_updates_status === 'Subscribed',
		`${inst.vars.live_updates_status} after ${subMs} ms, listener ${inst.getNotificationHost()}:${PORT}`,
	)
	check('live mode (heartbeat replaces full poll)', inst._liveMode === true)
	await inst.heartbeatTick()
	check(
		'heartbeat answered',
		!inst._frameDown && !inst._missedHeartbeats,
		inst._powerStatusWarned ? 'frame has no usable powerStatus: warned once' : 'powerStatus OK',
	)

	// ---------- 3. Optional changes: does the frame notify, and does the module follow? ----------
	const notes = () => inst.logs.filter(([, m]) => /Live update received/.test(m))
	const touched = []
	const step = async (label, fn, varName, want) => {
		const n0 = notes().length
		const r = await fn()
		const ms = await until(() => inst.vars[varName] === want, 5000)
		await wait(1000) // let this step's notifications arrive (500 ms debounce) before the next step
		const got = notes()
			.slice(n0)
			.map(([, m]) => m.replace('Live update received: ', ''))
		check(
			`${label}: ${varName} -> ${want}`,
			ms >= 0,
			`${ms >= 0 ? ms + ' ms' : 'not seen in 5 s'}; frame said ${r === undefined ? '(sent by the module action)' : JSON.stringify(r?.result ?? r?.error ?? r).slice(0, 80)}; notifications ${got.join(' | ') || 'none'}`,
		)
	}
	if (CHANGES) {
		say('\n== Changes (each put back as found) ==')
		const s0 = live[0]
		const neutral = (v) => v === 'No' || v === 'Off'
		try {
			if (s0 && neutral(inst.vars[`source_${s0.id + 1}_frozen`])) {
				touched.push(['freezeDestSource', { type: 0, id: s0.id, screengroup: 0, mode: 0 }])
				await step(
					`freeze source "${s0.Name}" (from another client)`,
					() => rpc('freezeDestSource', { type: 0, id: s0.id, screengroup: 0, mode: 1 }),
					`source_${s0.id + 1}_frozen`,
					'Yes',
				)
				await step(
					'unfreeze it',
					() => rpc('freezeDestSource', { type: 0, id: s0.id, screengroup: 0, mode: 0 }),
					`source_${s0.id + 1}_frozen`,
					'No',
				)
			} else note('source freeze', 'skipped (no live input, or it is already frozen)')
			const sc = screens[0]
			if (sc && neutral(inst.vars[`screen_${sc.id}_frozen`])) {
				touched.push(['freezeDestSource', { type: 2, id: sc.id, screengroup: 0, mode: 0 }])
				await step(
					`freeze screen "${sc.Name}" (from another client)`,
					() => rpc('freezeDestSource', { type: 2, id: sc.id, screengroup: 0, mode: 1 }),
					`screen_${sc.id}_frozen`,
					'Yes',
				)
				await step(
					'unfreeze it',
					() => rpc('freezeDestSource', { type: 2, id: sc.id, screengroup: 0, mode: 0 }),
					`screen_${sc.id}_frozen`,
					'No',
				)
			} else note('screen freeze', 'skipped (no screen, or it is already frozen)')
			if (sc && inst.vars[`screen_${sc.id}_armed`] === 'No') {
				touched.push(['armUnarmDestination', { arm: 0, ScreenDestination: [{ id: sc.id }], AuxDestination: [] }])
				await step(
					`arm toggle on "${sc.Name}" (Companion action)`,
					() => inst.actions.arm_unarm_destination.callback({ options: { destId: sc.id, arm: 'toggle' } }),
					`screen_${sc.id}_armed`,
					'Yes',
				)
				await step(
					'arm toggle again',
					() => inst.actions.arm_unarm_destination.callback({ options: { destId: sc.id, arm: 'toggle' } }),
					`screen_${sc.id}_armed`,
					'No',
				)
			} else note('arm', 'skipped (no screen, or it is already armed)')
			if (sc && inst.vars[`screen_${sc.id}_test_pattern`] === 'Off') {
				touched.push(['changeContent', { id: sc.id, TestPattern: 0 }])
				await step(
					`test pattern on "${sc.Name}" (from another client)`,
					() => rpc('changeContent', { id: sc.id, TestPattern: 3 }),
					`screen_${sc.id}_test_pattern`,
					'100% Color Bars',
				)
				await step(
					'test pattern off',
					() => rpc('changeContent', { id: sc.id, TestPattern: 0 }),
					`screen_${sc.id}_test_pattern`,
					'Off',
				)
			} else note('test pattern', 'skipped (no screen, or a pattern is already on)')
			const ax = auxes[0]
			if (ax && neutral(inst.vars[`aux_${ax.id}_frozen`])) {
				touched.push(['freezeDestSource', { type: 3, id: ax.id, screengroup: 0, mode: 0 }])
				await step(
					`freeze aux "${ax.Name}" (from another client)`,
					() => rpc('freezeDestSource', { type: 3, id: ax.id, screengroup: 0, mode: 1 }),
					`aux_${ax.id}_frozen`,
					'Yes',
				)
				await step(
					'unfreeze it',
					() => rpc('freezeDestSource', { type: 3, id: ax.id, screengroup: 0, mode: 0 }),
					`aux_${ax.id}_frozen`,
					'No',
				)
			} else note('aux freeze', ax ? 'skipped (already frozen)' : 'skipped (frame has no aux destinations)')
		} finally {
			for (const [m, p] of touched) await rpc(m, p) // put everything back, even after an error
		}
	}

	// ---------- wrap up ----------
	await inst.teardownNotifications()
	const errs = inst.logs.filter(([l]) => l === 'error')
	const warns = inst.logs.filter(([l]) => l === 'warn')
	say('\n== Module log ==')
	check('no module errors', errs.length === 0, errs.map(([, m]) => m).join(' | '))
	for (const [, m] of warns) say(`WARN  ${m}`)
	say(fails ? `\n${fails} check(s) failed` : '\nAll checks OK')
	fs.mkdirSync(OUT_DIR, { recursive: true })
	const safe = (s) => String(s || 'unknown').replace(/[^\w.-]+/g, '_')
	const file = path.join(
		OUT_DIR,
		`module-check_${safe(frame.FrameTypeName)}_${safe(frame.Version)}_${new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19)}.txt`,
	)
	fs.writeFileSync(file, report.join('\n') + '\n')
	fs.writeFileSync(file.replace(/\.txt$/, '-frame-settings.json'), JSON.stringify(fsr, null, 2))
	console.log(`Saved: ${file}`)
	process.exit(fails ? 1 : 0)
})().catch(async (err) => {
	console.error(`Module check error: ${err.stack || err}`)
	try {
		if (inst) await inst.teardownNotifications() // don't leave a subscription on the frame
	} catch {
		// best effort
	}
	process.exit(1)
})
