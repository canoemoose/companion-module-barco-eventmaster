// Layer freeze, and hiding input/output freeze on a PDS-4K. Mock frame shaped like the E2 on
// 9.2.6373 (two mixing layers as A/B pairs sharing a Z order, plus a single layer) and the PDS-4K
// on 9.2.5963 (one mixing layer per screen, named LayerA/LayerB).
/* eslint-disable n/no-process-exit -- standalone test script */
const Module = require('module')
const http = require('http')
const path = require('path')
const MOD = path.resolve(__dirname, '..')
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
				if (l === 'error') console.log('  [log error]', m)
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
module.paths.unshift(path.join(MOD, 'node_modules'))

const layer = (id, Name, z, PgmMode, PvwMode, LastSrcIdx = 0) => ({
	id,
	Name,
	PgmMode,
	PvwMode,
	PgmZOrder: z,
	PvwZOrder: z,
	LinkLayerId: -1,
	Freeze: 0,
	LastSrcIdx,
})
const e2Frame = () => ({
	settings: { FrameType: 0, FrameTypeName: 'E2', Version: '9.2.6373' },
	sources: [{ id: 0, Name: 'Cam 1-1', SrcType: 0, InputCfgIndex: 0, DestIndex: -1, UserKeyIndex: -1, Freeze: 0 }],
	screens: [{ id: 0, Name: 'LED MAIN', DestOutMapCol: { DestOutMap: [{ id: 0, FrzMode: 0 }] } }],
	content: {
		0: {
			id: 0,
			IsActive: 0,
			BGLyr: [],
			Layers: [
				layer(0, 'Layer1-A', 0, 0, 1),
				layer(1, 'Layer1-B', 0, 1, 0),
				layer(2, 'Layer2-A', 2, 0, 1),
				layer(3, 'Layer2-B', 2, 1, 0),
				layer(4, 'Layer3', 4, 1, 1), // single layer on program reads PgmMode 1 and PvwMode 1
			],
		},
	},
})
const pdsFrame = () => ({
	settings: { FrameType: 6, FrameTypeName: 'PDS-4K', Version: '9.2.5963' },
	sources: [{ id: 0, Name: 'HDMIInput1-1', SrcType: 0, InputCfgIndex: 0, DestIndex: -1, UserKeyIndex: -1, Freeze: 0 }],
	screens: [
		{ id: 0, Name: 'PGM1', DestOutMapCol: { DestOutMap: [{ id: 0, FrzMode: 0 }] } },
		{ id: 1, Name: 'PGM2', DestOutMapCol: { DestOutMap: [{ id: 0, FrzMode: 0 }] } },
	],
	content: {
		0: { id: 0, IsActive: 0, BGLyr: [], Layers: [layer(0, 'LayerA', 0, 1, 0), layer(1, 'LayerB', 0, 0, 1)] },
		1: { id: 1, IsActive: 0, BGLyr: [], Layers: [layer(0, 'LayerA', 0, 1, 0), layer(1, 'LayerB', 0, 0, 1)] },
	},
})

let frame = e2Frame()
const calls = []
const server = http.createServer((req, res) => {
	let body = ''
	req.on('data', (c) => (body += c))
	req.on('end', () => {
		const { method, params } = JSON.parse(body)
		calls.push({ method, params })
		let response = null
		if (method === 'getFrameSettings') response = { System: { FrameCollection: { Frame: frame.settings } } }
		else if (method === 'listSources') response = frame.sources
		else if (method === 'listDestinations') response = { ScreenDestination: frame.screens, AuxDestination: [] }
		else if (method === 'listContent') response = frame.content[params.id] || null
		else if (method === 'changeContent') {
			for (const l of params.Layers || []) {
				const target = frame.content[params.id].Layers.find((x) => x.id === l.id)
				if (target && l.Freeze !== undefined) target.Freeze = l.Freeze
			}
			response = {}
		} else if (['listPresets', 'listCues', 'listUserKeys', 'listAuxContent'].includes(method)) response = []
		res.setHeader('content-type', 'application/json')
		res.end(JSON.stringify({ jsonrpc: '2.0', id: '0', result: { success: 0, response } }))
	})
})

const wait = (ms) => new Promise((r) => setTimeout(r, ms))
let fails = 0
const check = (label, cond) => {
	console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`)
	if (!cond) fails++
}

async function newInstance() {
	const EventMaster = require(path.join(MOD, 'node_modules/barco-eventmaster'))
	const inst = new Captured({})
	inst.config = { host: '127.0.0.1' }
	inst.previousVariableValues = {}
	inst.frameVariableDefinitions = []
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
	inst.CHOICES_TESTPATTERN = [{ label: 'Off', id: '0' }]
	inst.CHOICES_FREEZE = [
		{ label: 'Freeze', id: 1 },
		{ label: 'Unfreeze', id: 0 },
	]
	inst.eventmaster = new EventMaster('127.0.0.1')
	await inst.getFrameSettings()
	await inst.getSourcesFromEventmaster()
	await inst.getDestinationsFromEventmaster()
	inst.refreshDefinitions()
	// The first content read finds the layers and rebuilds the definitions
	await inst.autoPopulateSourceMonitoring()
	return inst
}
const lastChange = () => calls.filter((c) => c.method === 'changeContent').pop()

server.listen(9999, '127.0.0.1', async () => {
	require(path.join(MOD, 'eventmaster.js'))

	// ---------- E2 ----------
	const inst = await newInstance()
	const act = (options) => inst.actions.frz_layer_toggle.callback({ options })
	const fb = (options) => inst.feedbacks.layer_frozen.callback({ options })

	check('E2 is not treated as a PDS-4K', inst.isPdsFrame() === false && inst.hasInputOutputFreeze() === true)
	const groups = inst.screenLayerGroups(0)
	check(
		'layers grouped by Z order: two pairs and a single',
		groups.length === 3 &&
			JSON.stringify(groups.map((g) => g.layers.map((l) => l.id))) === '[[0,1],[2,3],[4]]' &&
			JSON.stringify(groups.map((g) => g.single)) === '[false,false,true]',
	)
	const choices = inst.actions.frz_layer_toggle?.options[0].choices || []
	check(
		'action dropdown lists logical layers with labels',
		JSON.stringify(choices.map((c) => c.label)) ===
			'["LED MAIN Layer 1","LED MAIN Layer 2","LED MAIN Layer 3 (single)"]' &&
			JSON.stringify(choices.map((c) => c.id)) === '["0:0","0:2","0:4"]',
	)
	check('feedback dropdown matches', inst.feedbacks.layer_frozen?.options[0].choices.length === 3)

	act({ layer: '0:2', bus: 'pgm', mode: 'toggle' })
	await wait(200)
	let c = lastChange()
	check(
		'program toggle freezes the half on program (Layer2-B, id 3)',
		c && c.params.id === 0 && c.params.Layers[0].id === 3 && c.params.Layers[0].Freeze === 1,
	)
	check('frame layer 3 frozen', frame.content[0].Layers[3].Freeze === 1)
	check(
		'feedback: program frozen, preview not',
		fb({ layer: '0:2', bus: 'pgm' }) === true && fb({ layer: '0:2', bus: 'pvw' }) === false,
	)
	check(
		'variables: layer 2 pgm Yes, pvw No',
		inst.vars.screen_0_layer_2_pgm_frozen === 'Yes' && inst.vars.screen_0_layer_2_pvw_frozen === 'No',
	)

	act({ layer: '0:2', bus: 'pgm', mode: 'toggle' })
	await wait(200)
	check(
		'second toggle unfreezes',
		frame.content[0].Layers[3].Freeze === 0 && fb({ layer: '0:2', bus: 'pgm' }) === false,
	)

	// Freeze on preview, then a transition swaps the pair: the frozen half arrives on program
	act({ layer: '0:2', bus: 'pvw', mode: '1' })
	await wait(200)
	c = lastChange()
	check(
		'preview freeze targets the half on preview (Layer2-A, id 2)',
		c.params.Layers[0].id === 2 && c.params.Layers[0].Freeze === 1,
	)
	const L = frame.content[0].Layers
	Object.assign(L[2], { PgmMode: 1, PvwMode: 0 })
	Object.assign(L[3], { PgmMode: 0, PvwMode: 1 })
	await inst.autoPopulateSourceMonitoring({ screens: [0], auxes: [] })
	check(
		'after a transition the freeze shows on program',
		fb({ layer: '0:2', bus: 'pgm' }) === true && inst.vars.screen_0_layer_2_pgm_frozen === 'Yes',
	)
	check(
		'and preview is live',
		fb({ layer: '0:2', bus: 'pvw' }) === false && inst.vars.screen_0_layer_2_pvw_frozen === 'No',
	)
	act({ layer: '0:2', bus: 'pgm', mode: 'toggle' })
	await wait(200)
	check('program toggle now releases Layer2-A (id 2)', lastChange().params.Layers[0].id === 2 && L[2].Freeze === 0)

	// Single layer on program (reads Pgm 1 and Pvw 1): program freezes it, preview finds nothing
	act({ layer: '0:4', bus: 'pgm', mode: 'toggle' })
	await wait(200)
	check('single layer on program: program freezes layer 4', lastChange().params.Layers[0].id === 4 && L[4].Freeze === 1)
	// One layer shown on both buses: freezing it freezes it everywhere, so both feedbacks light
	check(
		'single layer on program shows frozen on program and preview',
		fb({ layer: '0:4', bus: 'pgm' }) === true &&
			fb({ layer: '0:4', bus: 'pvw' }) === true &&
			inst.vars.screen_0_layer_3_pgm_frozen === 'Yes' &&
			inst.vars.screen_0_layer_3_pvw_frozen === 'Yes',
	)
	act({ layer: '0:4', bus: 'pvw', mode: 'toggle' })
	await wait(200)
	check(
		'the preview button acts on the same layer: unfreezes layer 4',
		lastChange().params.Layers[0].id === 4 && L[4].Freeze === 0,
	)

	// A mixing layer not on program: nothing sent, a warning logged
	Object.assign(L[0], { PgmMode: 0, PvwMode: 1 })
	Object.assign(L[1], { PgmMode: 0, PvwMode: 0 })
	await inst.autoPopulateSourceMonitoring({ screens: [0], auxes: [] })
	const before = calls.filter((x) => x.method === 'changeContent').length
	act({ layer: '0:0', bus: 'pgm', mode: 'toggle' })
	await wait(100)
	check('layer not on program: nothing sent', calls.filter((x) => x.method === 'changeContent').length === before)
	check(
		'and a warning says why',
		inst.logs.some(([l, m]) => l === 'warn' && /Layer 1 has nothing on program/.test(m)),
	)
	check(
		'unknown layer: nothing sent',
		(act({ layer: '9:9', mode: 'toggle' }), calls.filter((x) => x.method === 'changeContent').length === before),
	)

	// Variable definitions and presets
	const ids = inst.varDefs.map((v) => v.variableId)
	check(
		'variable defs: program and preview for every layer',
		ids.includes('screen_0_layer_1_pgm_frozen') &&
			ids.includes('screen_0_layer_2_pvw_frozen') &&
			ids.includes('screen_0_layer_3_pgm_frozen') &&
			ids.includes('screen_0_layer_3_pvw_frozen') &&
			!ids.includes('screen_0_layer_3_frozen'),
	)
	check(
		'E2 keeps source and screen freeze variables',
		ids.includes('source_1_frozen') && ids.includes('screen_0_frozen'),
	)
	const p = inst.presets.freeze_layer_0_2
	check(
		'layer preset: program toggle with layer_frozen feedback',
		p?.category === 'Freeze Layers' &&
			p.steps[0].down[0].actionId === 'frz_layer_toggle' &&
			p.steps[0].down[0].options.layer === '0:2' &&
			p.steps[0].down[0].options.bus === 'pgm' &&
			p.feedbacks[0].feedbackId === 'layer_frozen' &&
			p.feedbacks[0].options.bus === 'pgm' &&
			p.style.text === 'Freeze\\n$(eventmaster:screen_0_label)\\nL2 PGM',
	)
	const pv = inst.presets.freeze_layer_pvw_0_2
	check(
		'preview preset: action and feedback both on preview',
		pv?.category === 'Freeze Layers' &&
			pv.steps[0].down[0].options.bus === 'pvw' &&
			pv.feedbacks[0].options.bus === 'pvw' &&
			pv.style.text === 'Freeze\\n$(eventmaster:screen_0_label)\\nL2 PVW',
	)
	check(
		'a program and a preview preset per logical layer',
		Object.keys(inst.presets).filter((k) => k.startsWith('freeze_layer_')).length === 6,
	)
	check(
		'every layer preset: action bus matches feedback bus',
		Object.entries(inst.presets)
			.filter(([k]) => k.startsWith('freeze_layer_'))
			.every(([, x]) => x.steps[0].down[0].options.bus === x.feedbacks[0].options.bus),
	)
	check(
		'E2 keeps source and screen freeze controls',
		!!inst.actions.frz_source_toggle &&
			!!inst.actions.frz_screen_toggle &&
			!!inst.feedbacks.source_frozen &&
			!!inst.presets.freeze_source_0 &&
			!!inst.presets.freeze_screen_0,
	)

	// Adding a layer in EMT: the next content read rebuilds the dropdowns
	L.push(layer(5, 'Layer4', 6, 0, 0, -1))
	await inst.autoPopulateSourceMonitoring({ screens: [0], auxes: [] })
	check(
		'a new layer appears in the dropdown and presets',
		inst.actions.frz_layer_toggle.options[0].choices.some((x) => x.label === 'LED MAIN Layer 4 (single)') &&
			!!inst.presets.freeze_layer_0_5,
	)

	// ---------- PDS-4K ----------
	frame = pdsFrame()
	const pds = await newInstance()
	check('PDS-4K detected', pds.isPdsFrame() === true && pds.hasInputOutputFreeze() === false)
	check(
		'PDS-4K: no source/screen freeze toggles, feedbacks or presets',
		!pds.actions.frz_source_toggle &&
			!pds.actions.frz_screen_toggle &&
			!pds.feedbacks.source_frozen &&
			!pds.feedbacks.screen_frozen &&
			!Object.keys(pds.presets).some((k) => k.startsWith('freeze_source_') || k.startsWith('freeze_screen_')),
	)
	const pids = pds.varDefs.map((v) => v.variableId)
	check(
		'PDS-4K: no source/screen frozen variables',
		!pids.includes('source_1_frozen') && !pids.includes('screen_0_frozen'),
	)
	check('PDS-4K: upstream freeze actions hidden too', !pds.actions.frz_Source && !pds.actions.freeze_dest)
	check('E2 keeps upstream freeze actions', !!inst.actions.frz_Source && !!inst.actions.freeze_dest)
	check(
		'PDS-4K: one mixing layer per screen, named LayerA/LayerB',
		JSON.stringify(pds.actions.frz_layer_toggle.options[0].choices.map((x) => x.label)) ===
			'["PGM1 Layer 1","PGM2 Layer 1"]',
	)
	pds.actions.frz_layer_toggle.callback({ options: { layer: '1:0', bus: 'pgm', mode: 'toggle' } })
	await wait(200)
	c = lastChange()
	check(
		'PDS-4K layer freeze sends changeContent to the right screen and layer',
		c.params.id === 1 && c.params.Layers[0].id === 0,
	)
	check('PDS-4K layer frozen in variable', pds.vars.screen_1_layer_1_pgm_frozen === 'Yes')
	check('PDS-4K layer presets built', !!pds.presets.freeze_layer_0_0 && !!pds.presets.freeze_layer_1_0)

	// Split PDS-4K layer (modes as read on PGM1, 9.2.5963): JSON-RPC doesn't say it is split, so the
	// layer stays one entry and the bus picks whatever is on it
	const P = frame.content[0].Layers
	const pdsState = async (a, b) => {
		Object.assign(P[0], a)
		Object.assign(P[1], b)
		await pds.autoPopulateSourceMonitoring({ screens: [0], auxes: [] })
	}
	const pact = (options) => pds.actions.frz_layer_toggle.callback({ options })
	const pfb = (options) => pds.feedbacks.layer_frozen.callback({ options })
	await pdsState({ PgmMode: 1, PvwMode: 1 }, { PgmMode: 1, PvwMode: 1 }) // split, both on program
	check('split layer stays one entry', pds.screenLayerGroups(0).length === 1)
	pact({ layer: '0:0', bus: 'pgm', mode: 'toggle' })
	await wait(200)
	c = lastChange()
	check(
		'split, both on program: one changeContent freezes both halves',
		c.params.id === 0 &&
			JSON.stringify(c.params.Layers) === '[{"id":0,"Freeze":1},{"id":1,"Freeze":1}]' &&
			P[0].Freeze === 1 &&
			P[1].Freeze === 1,
	)
	check(
		'and both feedbacks are on (split halves show on both buses)',
		pfb({ layer: '0:0', bus: 'pgm' }) === true && pfb({ layer: '0:0', bus: 'pvw' }) === true,
	)
	P[1].Freeze = 0 // one half released elsewhere: still counts as frozen, toggle releases the rest
	await pds.autoPopulateSourceMonitoring({ screens: [0], auxes: [] })
	check('any half frozen: feedback stays on', pfb({ layer: '0:0', bus: 'pgm' }) === true)
	pact({ layer: '0:0', bus: 'pgm', mode: 'toggle' })
	await wait(200)
	check(
		'toggle then unfreezes both',
		JSON.stringify(lastChange().params.Layers) === '[{"id":0,"Freeze":0},{"id":1,"Freeze":0}]',
	)
	await pdsState({ PgmMode: 0, PvwMode: 1 }, { PgmMode: 1, PvwMode: 1 }) // split, only B on program
	pact({ layer: '0:0', bus: 'pgm', mode: 'toggle' })
	await wait(200)
	check(
		'split, only B on program: program freezes B alone',
		JSON.stringify(lastChange().params.Layers) === '[{"id":1,"Freeze":1}]',
	)
	pact({ layer: '0:0', bus: 'pvw', mode: 'toggle' })
	await wait(200)
	// Preview holds A and B (B is on both buses); B is frozen, so the preview toggle releases both
	check(
		'preview covers A and B; B frozen, so the toggle unfreezes both',
		JSON.stringify(lastChange().params.Layers) === '[{"id":0,"Freeze":0},{"id":1,"Freeze":0}]',
	)
	pact({ layer: '0:0', bus: 'pvw', mode: 'toggle' })
	await wait(200)
	check(
		'preview toggle again freezes both',
		JSON.stringify(lastChange().params.Layers) === '[{"id":0,"Freeze":1},{"id":1,"Freeze":1}]',
	)
	check(
		'variables follow each bus',
		pds.vars.screen_0_layer_1_pgm_frozen === 'Yes' && pds.vars.screen_0_layer_1_pvw_frozen === 'Yes',
	)
	await pdsState({ PgmMode: 0, PvwMode: 1, Freeze: 0 }, { PgmMode: 1, PvwMode: 1, Freeze: 0 })
	pact({ layer: '0:0', bus: 'pvw', mode: 'toggle' })
	await wait(200)
	check(
		'nothing frozen: preview freezes A and B',
		JSON.stringify(lastChange().params.Layers) === '[{"id":0,"Freeze":1},{"id":1,"Freeze":1}]',
	)
	check(
		'program feedback on (B frozen), preview on',
		pfb({ layer: '0:0', bus: 'pgm' }) && pfb({ layer: '0:0', bus: 'pvw' }),
	)

	console.log(fails ? `\n${fails} FAILED` : '\nAll passed')
	server.close()
	process.exit(fails ? 1 : 0)
})
