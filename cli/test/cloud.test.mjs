import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile, execFileSync } from 'node:child_process'
import { promisify } from 'node:util'
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const cli = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'index.js')

function makeEnv(cloudUrl) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'leash-cloud-test-'))
  const leashDir = path.join(base, 'leash')
  const claudeDir = path.join(base, 'claude')
  fs.mkdirSync(claudeDir, { recursive: true })
  fs.writeFileSync(path.join(claudeDir, 'settings.json'), JSON.stringify({ model: 'opus' }) + '\n')
  return {
    base,
    leashDir,
    claudeDir,
    env: {
      ...process.env,
      LEASH_DIR: leashDir,
      CLAUDE_CONFIG_DIR: claudeDir,
      LEASH_CLOUD_URL: cloudUrl ?? 'http://127.0.0.1:9', // unreachable: push fails, fail-open
      LEASH_OFFLINE: '1', // never hit platform APIs from tests (push is separate)
    },
  }
}

const run = (env, ...args) => execFileSync('node', [cli, ...args], { encoding: 'utf8', env })

test('connect creates a fleet token, prints the URL and installs the SessionEnd hook', () => {
  const t = makeEnv()
  const out = run(t.env, 'connect')
  const config = JSON.parse(fs.readFileSync(path.join(t.leashDir, 'cloud.json'), 'utf8'))
  assert.match(config.token, /^flt_[a-f0-9]{24}$/)
  assert.ok(out.includes('/f/' + config.token))
  const settings = JSON.parse(fs.readFileSync(path.join(t.claudeDir, 'settings.json'), 'utf8'))
  assert.equal(settings.model, 'opus', 'existing settings preserved')
  const cmds = JSON.stringify(settings.hooks.SessionEnd)
  assert.ok(cmds.includes('getleash push'))
  // idempotent: reconnecting keeps one hook and the same token
  run(t.env, 'connect')
  const settings2 = JSON.parse(fs.readFileSync(path.join(t.claudeDir, 'settings.json'), 'utf8'))
  assert.equal(settings2.hooks.SessionEnd.length, 1)
  const config2 = JSON.parse(fs.readFileSync(path.join(t.leashDir, 'cloud.json'), 'utf8'))
  assert.equal(config2.token, config.token)
})

test('connect --fleet joins an existing fleet token', () => {
  const t = makeEnv()
  const token = 'flt_' + 'ab12'.repeat(6)
  const out = run(t.env, 'connect', '--fleet', token)
  assert.ok(out.includes('/f/' + token))
  const config = JSON.parse(fs.readFileSync(path.join(t.leashDir, 'cloud.json'), 'utf8'))
  assert.equal(config.token, token)
})

test('connect --off removes the hook and the local token', () => {
  const t = makeEnv()
  run(t.env, 'connect')
  run(t.env, 'connect', '--off')
  assert.ok(!fs.existsSync(path.join(t.leashDir, 'cloud.json')))
  const settings = JSON.parse(fs.readFileSync(path.join(t.claudeDir, 'settings.json'), 'utf8'))
  assert.ok(!JSON.stringify(settings).includes('getleash push'))
  assert.equal(settings.model, 'opus')
})

test('push --quiet without a config is silent and exits 0', () => {
  const t = makeEnv()
  const out = run(t.env, 'push', '--quiet')
  assert.equal(out.trim(), '')
})

test('push sends a metrics-only snapshot — no filesystem paths, no transcript content', async () => {
  let received = null
  const server = createServer((req, res) => {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      received = JSON.parse(body)
      res.setHeader('Content-Type', 'application/json')
      res.end('{"ok":true}')
    })
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const url = 'http://127.0.0.1:' + server.address().port
  const t = makeEnv(url)
  try {
    // async exec: a sync child would block this process's event loop and the server could never reply
    await promisify(execFile)('node', [cli, 'connect', '--no-hook'], { encoding: 'utf8', env: t.env })
    assert.ok(received, 'ingest endpoint was called')
    assert.match(received.token, /^flt_/)
    assert.match(received.machine.id, /^[a-f0-9]{12}$/)
    const snap = received.snapshot
    assert.equal(snap.v, 2)
    assert.equal(typeof snap.totals.costUSD, 'number')
    assert.ok(Array.isArray(snap.topProjects))
    assert.ok(Array.isArray(snap.daily), 'daily pulse data present (empty on a machine with no Claude history)')
    const flat = JSON.stringify(snap)
    assert.ok(!flat.includes(os.homedir()), 'snapshot must not contain home paths')
    assert.ok(!flat.includes('/Users/') && !flat.includes('/home/'), 'snapshot must not contain absolute paths')
  } finally {
    server.close()
  }
})

test('link with no args lists the five providers', () => {
  const t = makeEnv()
  const out = run(t.env, 'link')
  for (const p of ['GitHub Actions', 'Vercel', 'Render', 'Railway', 'Cloudflare Workers']) {
    assert.ok(out.includes(p), p + ' listed')
  }
})

test('link rejects an unknown provider', () => {
  const t = makeEnv()
  assert.throws(() => run(t.env, 'link', 'heroku', 'tok_x'), /unknown provider/)
})
