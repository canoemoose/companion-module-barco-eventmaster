const Module = require('module')
const http = require('http')
const path = require('path')
const MOD = require('path').resolve(__dirname, '..')
let Captured
const origLoad = Module._load
Module._load = function (req, parent, isMain) {
	if (req === '@companion-module/base') {
		class InstanceBase {
			constructor() {
				this.vars = {}
				this.fbChecks = []
			}
			log(l, m) {
				if (l === 'error') console.log('  [log error]', m)
			}
			setVariableValues(v) {
				Object.assign(this.vars, v)
			}
			setVariableDefinitions(d) {
				this.varDefs = d
			}
			checkFeedbacks(...ids) {
				this.fbChecks.push(ids)
			}
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

// Mock frame
const frame = {
	sources: [
		{ id: 0, Name: 'Cam 1-1', SrcType: 0, InputCfgIndex: 0, Freeze: 0 },
		{ id: 1, Name: 'PPT-2', SrcType: 0, InputCfgIndex: 1, Freeze: 0 },
		{ id: 2, Name: 'Still Logo', SrcType: 1, InputCfgIndex: -1, StillIndex: 0, Freeze: 1 },
		{
			id: 3,
			Name: 'LED MAIN-4',
			SrcType: 0,
			InputCfgIndex: -1,
			StillIndex: -1,
			DestIndex: 0,
			UserKeyIndex: -1,
			Freeze: 0,
		},
		{ id: 4, Name: 'Key-5', SrcType: 0, InputCfgIndex: 2, StillIndex: -1, DestIndex: -1, UserKeyIndex: 0, Freeze: 0 }, // frozen elsewhere, not on any layer
	],
	screens: [
		{
			id: 0,
			Name: 'LED MAIN',
			// Shape returned by 9.2.6318: DestOutMapCol is an object, outputs carry FrzMode
			DestOutMapCol: {
				DestOutMap: [
					{ id: 0, Name: 'Out 1', FrzMode: 0 },
					{ id: 1, Name: 'Out 2', FrzMode: 0 },
				],
			},
		},
	],
	// 9.2.6318 shape: aux freeze is FrzMode on the AuxDestination
	auxes: [{ id: 0, Name: 'Record-1', AuxStreamMode: 1, FrzMode: 0 }],
	calls: [],
}
const server = http.createServer((req, res) => {
	let body = ''
	req.on('data', (c) => (body += c))
	req.on('end', () => {
		const { method, params } = JSON.parse(body)
		frame.calls.push({ method, params })
		let response = null
		if (method === 'listSources') response = frame.sources
		else if (method === 'listDestinations') response = { ScreenDestination: frame.screens, AuxDestination: frame.auxes }
		else if (method === 'freezeDestSource') {
			if (params.type === 0) frame.sources.find((s) => s.id === params.id).Freeze = params.mode
			if (params.type === 3) frame.auxes.find((a) => a.id === params.id).FrzMode = params.mode
			if (params.type === 2)
				frame.screens.find((s) => s.id === params.id).DestOutMapCol.DestOutMap.forEach((o) => (o.FrzMode = params.mode))
		}
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

server.listen(9999, '127.0.0.1', async () => {
	require(path.join(MOD, 'eventmaster.js'))
	const EventMaster = require(path.join(MOD, 'node_modules/barco-eventmaster'))
	const inst = new Captured({})
	inst.previousVariableValues = {}
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
	await inst.refreshFreezeState()
	inst.refreshDefinitions()

	const fb = (id, options) => inst.feedbacks[id].callback({ options })
	const act = (id, options) => inst.actions[id].callback({ options })

	check(
		'actions registered',
		!!inst.actions.frz_source_toggle && !!inst.actions.frz_screen_toggle && !!inst.actions.frz_aux_toggle,
	)
	check(
		'feedbacks registered',
		!!inst.feedbacks.source_frozen && !!inst.feedbacks.screen_frozen && !!inst.feedbacks.aux_frozen,
	)
	check('existing actions intact', !!inst.actions.frz_Source && !!inst.actions.freeze_dest)
	check('initial: CAM 1 not frozen', fb('source_frozen', { source: 0 }) === false)
	check('source frozen off-layer is reported (Still Logo)', fb('source_frozen', { source: 2 }) === true)
	check('variable source_3_frozen = Yes', inst.vars.source_3_frozen === 'Yes')

	act('frz_source_toggle', { source: 0, mode: 'toggle' })
	await wait(150)
	const last = frame.calls.filter((c) => c.method === 'freezeDestSource').pop()
	check(
		'toggle sends freeze (mode 1, type 0) for CAM 1',
		last.params.mode === 1 && last.params.type === 0 && last.params.id === 0,
	)
	check('feedback true after toggle', fb('source_frozen', { source: 0 }) === true)
	check('variable source_1_frozen = Yes', inst.vars.source_1_frozen === 'Yes')

	act('frz_source_toggle', { source: 0, mode: 'toggle' })
	await wait(150)
	check('second toggle unfreezes', frame.sources[0].Freeze === 0 && fb('source_frozen', { source: 0 }) === false)

	// External change (e.g. from console) picked up on refresh
	frame.sources[1].Freeze = 1
	await inst.refreshFreezeState()
	check('external freeze on PPT picked up by refresh', fb('source_frozen', { source: 1 }) === true)
	act('frz_source_toggle', { source: 1, mode: 'toggle' })
	await wait(150)
	check('toggle after external freeze unfreezes (not double-freeze)', frame.sources[1].Freeze === 0)

	act('frz_source_toggle', { source: 1, mode: '1' })
	await wait(150)
	check('explicit Freeze mode works', frame.sources[1].Freeze === 1)

	// Screen
	check('screen not frozen', fb('screen_frozen', { destId: 0, match: 'any' }) === false)
	act('frz_screen_toggle', { destId: 0, mode: 'toggle' })
	await wait(150)
	const sl = frame.calls.filter((c) => c.method === 'freezeDestSource').pop()
	check('screen toggle sends type 2 mode 1', sl.params.type === 2 && sl.params.mode === 1)
	check('screen feedback true', fb('screen_frozen', { destId: 0, match: 'all' }) === true)
	check('screen variable = Yes', inst.vars.screen_0_frozen === 'Yes')
	frame.screens[0].DestOutMapCol.DestOutMap[1].FrzMode = 0
	await inst.refreshFreezeState()
	check(
		'partial screen freeze: any=true, all=false, var=Partial',
		fb('screen_frozen', { destId: 0, match: 'any' }) === true &&
			fb('screen_frozen', { destId: 0, match: 'all' }) === false &&
			inst.vars.screen_0_frozen === 'Partial',
	)

	// Barco's 8.2 doc shape (DestOutMapColl array, Freeze) still works, for other firmware
	const legacy = {
		DestOutMapColl: [
			{
				id: 0,
				DestOutMap: [
					{ id: 0, Freeze: 1 },
					{ id: 1, Freeze: 0 },
				],
			},
		],
	}
	check(
		'doc shape (DestOutMapColl/Freeze) read as fallback',
		inst
			.screenOutputs(legacy)
			.map((o) => inst.outputFreezeValue(o))
			.join() === '1,0',
	)
	inst.setOutputFreeze(legacy.DestOutMapColl[0].DestOutMap[1], 1)
	check(
		'optimistic update writes Freeze on doc shape, not FrzMode',
		legacy.DestOutMapColl[0].DestOutMap[1].Freeze === 1 && legacy.DestOutMapColl[0].DestOutMap[1].FrzMode === undefined,
	)
	const single = { DestOutMapCol: { DestOutMap: { id: 0, FrzMode: 1 } } }
	check('single output object (not array) read', inst.screenOutputs(single).length === 1)
	check('screen with no outputs is not frozen', inst.isScreenFrozen(99) === false)

	// Aux
	check('aux not frozen', fb('aux_frozen', { auxId: 0 }) === false && inst.vars.aux_0_frozen === 'No')
	act('frz_aux_toggle', { auxId: 0, mode: 'toggle' })
	await wait(150)
	const al = frame.calls.filter((c) => c.method === 'freezeDestSource').pop()
	check(
		'aux toggle sends type 3 (AuxDestination) mode 1',
		al.params.type === 3 && al.params.id === 0 && al.params.mode === 1,
	)
	check(
		'aux feedback true and variable Yes',
		fb('aux_frozen', { auxId: 0 }) === true && inst.vars.aux_0_frozen === 'Yes',
	)
	check('frame aux frozen', frame.auxes[0].FrzMode === 1)
	act('frz_aux_toggle', { auxId: 0, mode: 'toggle' })
	await wait(150)
	check('second aux toggle unfreezes', frame.auxes[0].FrzMode === 0 && fb('aux_frozen', { auxId: 0 }) === false)
	frame.auxes[0].FrzMode = 1 // frozen elsewhere
	await inst.refreshFreezeState()
	check('external aux freeze read back (FrzMode)', inst.vars.aux_0_frozen === 'Yes')
	act('frz_aux_toggle', { auxId: 0, mode: 'toggle' })
	await wait(150)
	check('toggle after external aux freeze unfreezes', frame.auxes[0].FrzMode === 0)
	check('aux label var', inst.vars.aux_0_label === 'Record')

	// Overlapping refreshes coalesce rather than stack
	const before = frame.calls.length
	await Promise.all([inst.refreshFreezeState(), inst.refreshFreezeState(), inst.refreshFreezeState()])
	await wait(150)
	check('overlapping refreshes coalesce (<=4 RPCs, not 6)', frame.calls.length - before <= 4)

	// Presets
	const p = inst.presets
	check(
		'freeze presets built',
		!!p.freeze_source_0 && !!p.freeze_screen_0 && p.freeze_source_0.feedbacks[0].feedbackId === 'source_frozen',
	)

	// Variable definitions
	inst.eventmasterData.presets = {}
	inst.frameVariableDefinitions = []
	inst.updateDestinationVariables = inst.updateDestinationVariables.bind(inst)
	inst.autoPopulateSourceMonitoring = async () => {}
	inst.updateDestinationVariables()
	const ids = inst.varDefs.map((v) => v.variableId)
	check(
		'variable defs include freeze vars',
		ids.includes('source_1_frozen') && ids.includes('screen_0_frozen') && ids.includes('aux_0_frozen'),
	)

	// Labels and preset styling
	const L = (n) => inst.buttonLabel(n)
	check('"Cam 1-1" -> "Cam 1"', inst.vars.source_1_label === 'Cam 1')
	check('"PPT-2" -> "PPT"', inst.vars.source_2_label === 'PPT')
	check('"Still Logo" unchanged', inst.vars.source_3_label === 'Still Logo')
	check(
		'only one number stripped',
		L('Cam 1-1') === 'Cam 1' && L('Lectern Cam 12-12') === 'Lectern Cam 12' && L('A-1-2') === 'A-1',
	)
	check(
		'names without -N untouched',
		L('Cam 1') === 'Cam 1' && L('CAM_3') === 'CAM_3' && L('CAM (3)') === 'CAM (3)' && L('Graphics') === 'Graphics',
	)
	check('hyphenated words untouched', L('Pre-show') === 'Pre-show' && L('Wide-A') === 'Wide-A')
	check('bare / empty untouched', L('-7') === '-7' && L('7') === '7' && L('') === '')
	check('screen label var', inst.vars.screen_0_label === 'LED MAIN')
	const ps = inst.presets.freeze_source_0
	check(
		'source preset idle text has label + Freeze, no FRZ, no input number',
		ps.style.text === 'Freeze\\n$(eventmaster:source_1_label)' && !JSON.stringify(ps).includes('FRZ'),
	)
	check('source preset frozen text = FROZEN', ps.feedbacks[0].style.text === 'FROZEN\\n$(eventmaster:source_1_label)')
	check(
		'screen preset uses label var',
		inst.presets.freeze_screen_0.style.text === 'Freeze\\n$(eventmaster:screen_0_label)',
	)
	const pa = inst.presets.freeze_aux_0
	check(
		'aux preset: toggle action, aux_frozen feedback, label text',
		pa?.category === 'Freeze Aux Destinations' &&
			pa.style.text === 'Freeze\\n$(eventmaster:aux_0_label)' &&
			pa.steps[0].down[0].actionId === 'frz_aux_toggle' &&
			pa.feedbacks[0].feedbackId === 'aux_frozen' &&
			pa.feedbacks[0].style.text === 'FROZEN\\n$(eventmaster:aux_0_label)',
	)
	check(
		'label var defs present',
		ids.includes('source_1_label') && ids.includes('screen_0_label') && ids.includes('aux_0_label'),
	)

	// Only live inputs get freeze presets / dropdown entries
	const pr = inst.presets
	check(
		'freeze presets for live inputs only',
		!!pr.freeze_source_0 && !!pr.freeze_source_1 && !pr.freeze_source_2 && !pr.freeze_source_3 && !pr.freeze_source_4,
	)
	const actIds = inst.actions.frz_source_toggle.options[0].choices.map((c) => c.id)
	const fbIds = inst.feedbacks.source_frozen.options[0].choices.map((c) => c.id)
	check('toggle action dropdown: inputs only', JSON.stringify(actIds) === '[0,1]')
	check('feedback dropdown: inputs only', JSON.stringify(fbIds) === '[0,1]')
	check(
		'original Freeze/Unfreeze Source action still lists everything',
		inst.actions.frz_Source.options[1].choices.length === 5,
	)

	console.log(fails ? `\n${fails} FAILED` : '\nAll passed')
	server.close()
	process.exit(fails ? 1 : 0)
})
