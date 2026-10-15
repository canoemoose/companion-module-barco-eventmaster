// Build the Companion package and check it actually contains the bundled module.
//
//   node tools/package.js            build (Windows workarounds applied), then check
//   node tools/package.js --check    only check the existing .tgz (runs after `npm run package`)
//
// Why: on Windows, companion-module-build runs `npx webpack` through PowerShell. Under Volta, the
// npm image's PowerShell shims are broken (they look for node_modules/npm/bin/npm-prefix.js, which
// isn't there), and Volta's node launcher puts that bin folder first on PATH. webpack then fails,
// the build tool carries on regardless, and the .tgz ships without main.js. So on Windows this runs
// the build with Companion's bundled node22 (the tools need node ^18.18 || ^22.18) and a temporary
// npx.cmd that runs the repo's own webpack-cli directly, with no npm involved.
/* eslint-disable n/no-process-exit -- standalone CLI */
'use strict'
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync, execFileSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..')
const pkg = require(path.join(ROOT, 'package.json'))
const tgz = path.join(ROOT, `${pkg.name}-${pkg.version}.tgz`)

function check() {
	if (!fs.existsSync(tgz)) {
		console.error(`PACKAGE CHECK FAILED: ${path.basename(tgz)} was not written`)
		process.exit(1)
	}
	const entries = execFileSync('tar', ['-tzf', tgz], { encoding: 'utf8' }).split(/\r?\n/)
	const missing = ['pkg/main.js', 'pkg/companion/manifest.json'].filter((f) => !entries.includes(f))
	if (missing.length) {
		console.error(`PACKAGE CHECK FAILED: ${path.basename(tgz)} is missing ${missing.join(', ')}`)
		console.error('The webpack step failed (see above). On Windows use: npm run package:win')
		process.exit(1)
	}
	const size = fs.statSync(tgz).size
	console.log(`Package OK: ${path.basename(tgz)} (${Math.round(size / 1024)} KB) contains pkg/main.js`)
}

function build() {
	const buildScript = path.join(ROOT, 'node_modules', '@companion-module', 'tools', 'scripts', 'build-connection.js')
	if (fs.existsSync(tgz)) fs.unlinkSync(tgz) // never mistake an old package for a fresh one
	if (process.platform !== 'win32') {
		const r = spawnSync(process.execPath, [buildScript], { cwd: ROOT, stdio: 'inherit' })
		if (r.status !== 0) process.exit(r.status || 1)
		return
	}

	const companionNode = path.join(
		process.env.ProgramFiles || 'C:\\Program Files',
		'Companion',
		'resources',
		'node-runtimes',
		'node22',
		'node.exe',
	)
	const node = fs.existsSync(companionNode) ? companionNode : process.execPath
	if (node === process.execPath) console.warn(`Companion node22 not found; building with ${process.version}`)

	const shimDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-npx-'))
	// webpack-cli comes with @companion-module/tools, hoisted into the repo's node_modules
	const webpackCli = path.join(ROOT, 'node_modules', 'webpack-cli', 'bin', 'cli.js')
	fs.writeFileSync(
		path.join(shimDir, 'npx-shim.js'),
		[
			"const { spawnSync } = require('child_process')",
			'const [cmd, ...rest] = process.argv.slice(2)',
			"if (cmd !== 'webpack') { console.error('npx stand-in only runs webpack, got: ' + cmd); process.exit(1) }",
			`const r = spawnSync(process.execPath, [${JSON.stringify(webpackCli)}, ...rest], { stdio: 'inherit' })`,
			'process.exit(r.status === null ? 1 : r.status)',
		].join('\n'),
	)
	fs.writeFileSync(path.join(shimDir, 'npx.cmd'), `@"${node}" "%~dp0npx-shim.js" %*\r\n`)

	const env = { ...process.env }
	const pathKey = Object.keys(env).find((k) => k.toUpperCase() === 'PATH') || 'Path'
	env[pathKey] = `${shimDir};${env[pathKey] || ''}`
	console.log(`Building with ${node}`)
	try {
		const r = spawnSync(node, [buildScript], { cwd: ROOT, stdio: 'inherit', env })
		if (r.status !== 0) process.exit(r.status || 1)
	} finally {
		fs.rmSync(shimDir, { recursive: true, force: true })
	}
}

if (!process.argv.includes('--check')) build()
check()
