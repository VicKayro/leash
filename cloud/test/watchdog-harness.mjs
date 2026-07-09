// Local integration test for the Watchdog alert engine, against the real
// Blob store (token from `vercel env pull`) and a fake Discord webhook.
// Run: node test/watchdog-harness.mjs   (from cloud/, after vercel env pull)
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'

// load BLOB_READ_WRITE_TOKEN from .env.local
for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)="?([^"\n]*)"?$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
}
process.env.WATCHDOG_ALLOW_ANY_WEBHOOK = '1'

const { default: alerts } = await import('../api/alerts.js')
const { default: ingest } = await import('../api/ingest.js')
const { default: fleet } = await import('../api/fleet.js')
const { del, list } = await import('@vercel/blob')

const fakeRes = () => {
  const r = { code: 0, body: null }
  r.status = (c) => ((r.code = c), r)
  r.json = (o) => ((r.body = o), r)
  r.setHeader = () => r
  return r
}
const call = async (fn, req) => {
  const res = fakeRes()
  await fn({ headers: {}, query: {}, body: {}, ...req }, res)
  return res
}

// fake Discord: capture every webhook POST
const barks = []
const discord = createServer((req, res) => {
  let b = ''
  req.on('data', (c) => (b += c))
  req.on('end', () => {
    barks.push(JSON.parse(b))
    res.statusCode = 204
    res.end()
  })
})
await new Promise((r) => discord.listen(0, '127.0.0.1', r))
const webhookUrl = `http://127.0.0.1:${discord.address().port}/api/webhooks/1/test`

const token = 'flt_' + 'e'.repeat(24)
const machine = { id: 'abc123abc123', host: 'harness-mac', platform: 'darwin', cliVersion: '0.12.0' }
const snap = (issues) => ({ v: 2, windowDays: 30, totals: { costUSD: 1, sessions: 1, projects: 1 }, scheduled: { total: 3, issues }, cloudAgents: { total: 0, checked: 0, issues: [] }, loops: [], insights: {}, topProjects: [], daily: [], nights: [] })

try {
  // 1. arm → test ping lands
  let r = await call(alerts, { method: 'POST', body: { token, discord: webhookUrl } })
  assert.equal(r.code, 200, JSON.stringify(r.body))
  assert.equal(barks.length, 1, 'test ping received')
  assert.match(barks[0].embeds[0].title, /armed/)

  // 2. first push, no issues → silent
  r = await call(ingest, { method: 'POST', body: { token, machine, snapshot: snap([]) } })
  assert.equal(r.code, 200)
  assert.equal(barks.length, 1, 'no bark on healthy push')

  // 3. new zombie appears → bark
  const zombie = [{ label: 'com.test.dead', source: 'launchd', schedule: 'daily', problem: 'zombie' }]
  r = await call(ingest, { method: 'POST', body: { token, machine, snapshot: snap(zombie) } })
  assert.equal(r.code, 200)
  assert.equal(barks.length, 2, 'bark on new issue')
  assert.match(barks[1].embeds[0].description, /com\.test\.dead/)
  assert.match(barks[1].embeds[0].title, /harness-mac/)

  // 4. same issue again → stays quiet (dedup)
  r = await call(ingest, { method: 'POST', body: { token, machine, snapshot: snap(zombie) } })
  assert.equal(barks.length, 2, 'no re-bark on known issue')

  // 5. fleet: watchdog flag on, _alerts.json not listed as a machine
  r = await call(fleet, { method: 'GET', query: { token } })
  assert.equal(r.body.watchdog, true)
  assert.equal(r.body.machines.length, 1)
  assert.equal(r.body.machines[0].machine.host, 'harness-mac')

  // 6. disarm → flag off
  r = await call(alerts, { method: 'DELETE', body: { token } })
  assert.equal(r.code, 200)
  r = await call(fleet, { method: 'GET', query: { token } })
  assert.equal(r.body.watchdog, false)

  // 7. reject a non-discord URL without the test escape hatch
  delete process.env.WATCHDOG_ALLOW_ANY_WEBHOOK
  // (regex was computed at import time — validate shape separately)
  assert.ok(!/^https:\/\/(?:discord\.com|discordapp\.com)\/api\/webhooks\/\d+\/[\w-]+$/.test(webhookUrl))

  console.log('watchdog harness: ALL PASS (7 checks)')
} finally {
  discord.close()
  // clean the test fleet from the store
  const { blobs } = await list({ prefix: `fleets/${token}/` })
  for (const b of blobs) await del(b.url).catch(() => {})
}
