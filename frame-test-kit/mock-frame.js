// Mock Event Master frame for rehearsing the frame test kit. Node 18, built-ins only.
//
//   node mock-frame.js [--host 127.0.0.1] [--json-port 9999] [--xml-port 9876]
//                      [--notify 92|rich] [--xml push|silent] [--blank]
//
// --notify 92   only PresetChanged and ScreenDestChanged fire (what EM 9.2 did on the first frame)
// --notify rich every action fires a plausible notification type (exercises the results matrix)
// --xml push    connected 9876 clients get an XML delta on freeze/take; silent sends nothing
// --blank       frame with nothing programmed (exercises the readiness check)
//
// Rehearsal only: POST /_mock/do {"action": "..."} simulates the operator doing a step in EMT.
/* eslint-disable n/no-process-exit -- standalone CLI */
'use strict'
const http = require('http')
const net = require('net')

const RICH = {
	freezeSource: 'InputCfgChanged',
	unfreezeSource: 'InputCfgChanged',
	freezeScreen: 'ScreenDestChanged',
	unfreezeScreen: 'ScreenDestChanged',
	recallPreset: 'PresetChanged',
	take: 'ScreenDestChanged',
	changeLayerSource: 'ScreenDestChanged',
	changeAuxSource: 'AUXDestChanged',
	freezeAux: 'AUXDestChanged',
	unfreezeAux: 'AUXDestChanged',
	renameSource: 'SourceChanged',
	changeInputCfg: 'InputCfgChanged',
	captureStill: 'StillChanged',
	changeBackground: 'BGSourceChanged',
	renameAux: 'AUXDestChanged',
	savePreset: 'PresetChanged',
	renameScreen: 'ScreenDestChanged',
	renameScreenBack: 'ScreenDestChanged',
}
const NINE_TWO = {
	savePreset: 'PresetChanged',
	renameScreen: 'ScreenDestChanged',
	renameScreenBack: 'ScreenDestChanged',
}
const XML_ACTIONS = new Set([
	'freezeSource',
	'unfreezeSource',
	'freezeScreen',
	'unfreezeScreen',
	'take',
	'changeLayerSource',
	'freezeAux',
	'unfreezeAux',
])

function initialState(blank) {
	if (blank)
		return {
			sources: [],
			screens: [],
			auxes: [],
			presets: [],
			stills: [],
			content: {},
			auxContent: {},
		}
	return {
		sources: [
			{ id: 0, Name: 'HDMI 1-1', InputCfgIndex: 0, StillIndex: -1, DestIndex: -1, UserKeyIndex: -1, Freeze: 0 },
			{ id: 1, Name: 'HDMI 2-2', InputCfgIndex: 1, StillIndex: -1, DestIndex: -1, UserKeyIndex: -1, Freeze: 0 },
			{ id: 2, Name: 'Screen 1-3', InputCfgIndex: -1, StillIndex: -1, DestIndex: 0, UserKeyIndex: -1, Freeze: 0 },
		],
		screens: [
			{
				id: 0,
				Name: 'Screen 1',
				DestOutMapColl: [{ id: 0, DestOutMap: [{ id: 0, Name: 'Out 1', Freeze: 0 }] }],
			},
		],
		auxes: [{ id: 0, Name: 'Aux 1', Freeze: 0 }],
		presets: [
			{ id: 0, presetSno: 1.0, Name: 'Preset 1' },
			{ id: 1, presetSno: 2.0, Name: 'Preset 2' },
		],
		stills: [],
		content: {
			0: {
				id: 0,
				Name: 'Screen 1',
				BGLyr: [
					{ id: 0, LastBGSourceIndex: -1 },
					{ id: 1, LastBGSourceIndex: -1 },
				],
				Layers: [
					{ id: 0, LastSrcIdx: 0, PgmMode: 1, PvwMode: 1, Freeze: 0 },
					{ id: 1, LastSrcIdx: 1, PgmMode: 1, PvwMode: 1, Freeze: 0 },
				],
			},
		},
		auxContent: { 0: { id: 0, Name: 'Aux 1', PgmLastSrcIndex: 0, PvwLastSrcIndex: 0 } },
	}
}

function createMock(opts = {}) {
	const o = { host: '127.0.0.1', jsonPort: 9999, xmlPort: 9876, notify: '92', xml: 'silent', blank: false, ...opts }
	const s = initialState(o.blank)
	const subs = []
	const xmlClients = new Set()
	const log = []
	const map = o.notify === 'rich' ? RICH : NINE_TWO

	const pushNotification = (type, ids) => {
		for (const sub of subs) {
			if (!sub.notification.includes(type)) continue
			const body = JSON.stringify({
				result: { method: 'notification', notificationType: type, change: { add: [], remove: [], update: ids } },
			})
			const req = http.request({
				host: sub.hostname,
				port: Number(sub.port),
				method: 'POST',
				path: '/',
				headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) },
			})
			req.on('response', (res) => res.resume())
			req.on('error', () => {})
			req.end(body)
		}
	}
	const pushXml = (action) => {
		if (o.xml !== 'push') return
		const xml = `<System id="0"><Event action="${action}" id="0"/></System>\r\n`
		for (const c of xmlClients) c.write(xml)
	}

	const doAction = (action) => {
		log.push(action)
		const src = s.sources[0]
		const scr = s.screens[0]
		const aux = s.auxes[0]
		const c0 = s.content[0]
		switch (action) {
			case 'freezeSource':
				if (src) src.Freeze = 1
				break
			case 'unfreezeSource':
				if (src) src.Freeze = 0
				break
			case 'freezeScreen':
				if (scr) scr.DestOutMapColl[0].DestOutMap[0].Freeze = 1
				break
			case 'unfreezeScreen':
				if (scr) scr.DestOutMapColl[0].DestOutMap[0].Freeze = 0
				break
			case 'take':
			case 'changeLayerSource':
				if (c0) c0.Layers[0].LastSrcIdx = c0.Layers[0].LastSrcIdx === 0 ? 1 : 0
				break
			case 'changeAuxSource':
				if (s.auxContent[0]) s.auxContent[0].PgmLastSrcIndex = 1
				break
			case 'freezeAux':
				if (aux) aux.Freeze = 1
				break
			case 'unfreezeAux':
				if (aux) aux.Freeze = 0
				break
			case 'renameSource':
				if (src) src.Name = 'Renamed-1'
				break
			case 'captureStill':
				s.stills.push({ id: s.stills.length, Name: `Still ${s.stills.length + 1}` })
				break
			case 'changeBackground':
				if (c0) c0.BGLyr[0].LastBGSourceIndex = 0
				break
			case 'renameAux':
				if (aux) aux.Name = 'Aux X'
				break
			case 'renameScreen':
				if (scr) scr.Name = 'Screen 1 X'
				break
			case 'renameScreenBack':
				if (scr) scr.Name = 'Screen 1'
				break
		}
		if (map[action]) pushNotification(map[action], [0])
		if (XML_ACTIONS.has(action)) pushXml(action)
	}

	const rpc = (method, params) => {
		switch (method) {
			case 'getFrameSettings':
				return {
					System: {
						FrameCollection: {
							Frame: {
								id: '00:0e:2b:mock',
								Name: 'MOCK-E2',
								FrameTypeName: 'E2',
								Version: '9.2.0',
								OSVersion: 'mock',
								Enet: { IP: o.host, MacAddress: '00:0E:2B:00:00:00' },
							},
						},
					},
				}
			case 'listSources':
				return s.sources
			case 'listDestinations':
				return { ScreenDestination: s.screens, AuxDestination: s.auxes }
			case 'listContent':
				return s.content[params.id] || null
			case 'listAuxContent':
				return s.auxContent[params.id] || null
			case 'listPresets':
				return s.presets
			case 'listStill':
				return s.stills
			case 'subscribe':
				subs.push(params)
				return null
			case 'unsubscribe':
				for (let i = subs.length - 1; i >= 0; i--)
					if (subs[i].hostname === params.hostname && String(subs[i].port) === String(params.port)) subs.splice(i, 1)
				return null
			default:
				return { error: `mock: method ${method} not implemented` }
		}
	}

	const httpServer = http.createServer((req, res) => {
		let body = ''
		req.on('data', (c) => (body += c))
		req.on('end', () => {
			res.setHeader('content-type', 'application/json')
			if (req.url === '/_mock/do') {
				const { action } = JSON.parse(body || '{}')
				doAction(action)
				return res.end('{"ok":true}')
			}
			let msg
			try {
				msg = JSON.parse(body)
			} catch {
				res.statusCode = 400
				return res.end('{}')
			}
			const response = rpc(msg.method, msg.params || {})
			res.end(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { success: 0, response } }))
		})
	})
	const xmlServer = net.createServer((sock) => {
		xmlClients.add(sock)
		sock.on('error', () => {})
		sock.on('close', () => xmlClients.delete(sock))
	})

	return {
		state: s,
		subs,
		log,
		doAction,
		start: () =>
			Promise.all([
				new Promise((r, j) => httpServer.once('error', j).listen(o.jsonPort, o.host, r)),
				new Promise((r, j) => xmlServer.once('error', j).listen(o.xmlPort, o.host, r)),
			]),
		stop: () => {
			for (const c of xmlClients) c.destroy()
			return Promise.all([new Promise((r) => httpServer.close(r)), new Promise((r) => xmlServer.close(r))])
		},
	}
}

module.exports = { createMock }

if (require.main === module) {
	const a = process.argv.slice(2)
	const arg = (n, d) => {
		const i = a.indexOf(n)
		return i >= 0 ? a[i + 1] : d
	}
	const mock = createMock({
		host: arg('--host', '127.0.0.1'),
		jsonPort: Number(arg('--json-port', 9999)),
		xmlPort: Number(arg('--xml-port', 9876)),
		notify: arg('--notify', '92'),
		xml: arg('--xml', 'silent'),
		blank: a.includes('--blank'),
	})
	mock.start().then(
		() => console.log('Mock frame running. Ctrl+C to stop.'),
		(err) => {
			console.error(`Mock frame failed to start: ${err.message}`)
			process.exit(1)
		},
	)
	process.on('SIGINT', () => mock.stop().then(() => process.exit(0)))
}
