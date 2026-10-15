/* eslint-disable n/no-process-exit -- test runner exit code */
// Automated rehearsal of the frame test kit: runs kit.js --auto end to end against the mock frame.
// Uses ports 19999/19876/13000 so it doesn't clash with the other suites or a running Companion.
const path = require('path')
const fs = require('fs')
const os = require('os')
const { execFile } = require('child_process')
const { createMock } = require('../frame-test-kit/mock-frame.js')

const KIT = path.resolve(__dirname, '../frame-test-kit/kit.js')
let fails = 0
const check = (l, c) => {
	console.log(`${c ? 'PASS' : 'FAIL'}  ${l}`)
	if (!c) fails++
}

async function run(mockOpts, extraArgs = []) {
	const mock = createMock({ jsonPort: 19999, xmlPort: 19876, ...mockOpts })
	await mock.start()
	const out = fs.mkdtempSync(path.join(os.tmpdir(), 'kit-test-'))
	const args = [
		KIT,
		'--frame',
		'127.0.0.1',
		'--local',
		'127.0.0.1',
		'--port',
		'13000',
		'--json-port',
		'19999',
		'--xml-port',
		'19876',
		'--settle',
		'0.2',
		'--auto',
		'--mock-control',
		'http://127.0.0.1:19999/_mock/do',
		'--out',
		out,
		...extraArgs,
	]
	const res = await new Promise((resolve) =>
		execFile(process.execPath, args, { timeout: 60000 }, (err, stdout, stderr) =>
			resolve({ code: err ? err.code : 0, stdout, stderr }),
		),
	)
	await mock.stop()
	const dir = fs.readdirSync(out).map((d) => path.join(out, d))[0]
	const results =
		dir && fs.existsSync(path.join(dir, 'results.json'))
			? JSON.parse(fs.readFileSync(path.join(dir, 'results.json'), 'utf8'))
			: null
	const md =
		dir && fs.existsSync(path.join(dir, 'results.md')) ? fs.readFileSync(path.join(dir, 'results.md'), 'utf8') : ''
	return { ...res, mock, dir, results, md }
}
const step = (r, id) => r.results.steps.find((s) => s.id === id)

;(async () => {
	// 1. Frame behaving like EM 9.2, XML push on
	let r = await run({ notify: '92', xml: 'push' })
	check('9.2 mock: kit exits cleanly', r.code === 0)
	check('9.2 mock: results.json and results.md written', !!r.results && r.md.includes('action x notification matrix'))
	check('9.2 mock: results folder named model_firmware_time', /E2_9\.2\.0_/.test(path.basename(r.dir || '')))
	check('9.2 mock: subscribed to all 11 types', r.results.subscribe?.success === 0)
	check('9.2 mock: subscription removed at the end', r.mock.subs.length === 0)
	check(
		'9.2 mock: readiness all present',
		r.results.ready.every((i) => i.pass),
	)
	check('9.2 mock: naming finds re-entry source', r.results.naming.reentry.includes('Screen 1-3'))
	check(
		'9.2 mock: all 19 steps ran',
		r.results.steps.length === 19 && r.results.steps.every((s) => s.status === 'done'),
	)
	check(
		'9.2 mock: A1 control got ScreenDestChanged',
		step(r, 'A1').notify.some((n) => n.type === 'ScreenDestChanged'),
	)
	check(
		'9.2 mock: A18 control got PresetChanged',
		step(r, 'A18').notify.some((n) => n.type === 'PresetChanged'),
	)
	check('9.2 mock: A2 freeze got no JSON notification', step(r, 'A2').notify.length === 0)
	check('9.2 mock: A2 freeze captured 9876 bytes', step(r, 'A2').xml.length > 0)
	check(
		'9.2 mock: A2 diff shows source Freeze 0 -> 1',
		step(r, 'A2').diff.some((d) => /sources\[#0\]\.Freeze: 0 -> 1/.test(d)),
	)
	check(
		'9.2 mock: A4 diff shows screen output Freeze',
		step(r, 'A4').diff.some((d) => /DestOutMap\[#0\]\.FrzMode: 0 -> 1/.test(d)),
	)
	check(
		'9.2 mock: A7 take shows layer source change',
		step(r, 'A7').diff.some((d) => /Layers\[#0\]\.LastSrcIdx/.test(d)),
	)
	check('9.2 mock: snapshot written per step', fs.readdirSync(path.join(r.dir, 'snapshots')).length === 20)
	check('9.2 mock: pktmon phase skipped in rehearsal', /skipped/.test(String(r.results.pktmon)))

	// 2. Frame that pushes a notification for everything, XML silent
	r = await run({ notify: 'rich', xml: 'silent' }, ['--steps', 'A2,A10'])
	check('rich mock: --steps runs only the named steps', r.results.steps.map((s) => s.id).join() === 'A2,A10')
	check(
		'rich mock: A2 freeze got InputCfgChanged',
		step(r, 'A2').notify.some((n) => n.type === 'InputCfgChanged'),
	)
	check(
		'rich mock: A10 got AUXDestChanged',
		step(r, 'A10').notify.some((n) => n.type === 'AUXDestChanged'),
	)
	check('rich mock: silent 9876 records nothing', step(r, 'A2').xml.length === 0)
	check('rich mock: matrix marks InputCfg for A2', /\| A2 \|[^\n]*\*\*1\*\*/.test(r.md))

	// 3. Blank frame: readiness reports what's missing and steps are skipped, not run
	r = await run({ blank: true })
	check('blank mock: kit exits cleanly', r.code === 0)
	check(
		'blank mock: readiness reports missing inputs',
		r.results.ready.some((i) => !i.pass && /live input/.test(i.name)),
	)
	check(
		'blank mock: every step skipped with a reason',
		r.results.steps.every((s) => /^skipped: frame has no/.test(s.status)),
	)
	check('blank mock: still unsubscribes', r.mock.subs.length === 0)

	console.log(fails ? `\n${fails} FAILED` : '\nAll kit checks passed')
	process.exit(fails ? 1 : 0)
})().catch((err) => {
	console.error(err)
	process.exit(1)
})
