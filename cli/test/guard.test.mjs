import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const cli = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'index.js')

function tmpEnv() {
  const leashDir = fs.mkdtempSync(path.join(os.tmpdir(), 'leash-test-'))
  const claudeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'leash-claude-'))
  fs.mkdirSync(path.join(claudeDir, 'projects'), { recursive: true })
  return { ...process.env, LEASH_DIR: leashDir, CLAUDE_CONFIG_DIR: claudeDir }
}

test('guard --daily installs gate + hook, --off removes them', () => {
  const env = tmpEnv()
  const out = execFileSync('node', [cli, 'guard', '--daily', '25'], { encoding: 'utf8', env })
  assert.ok(out.includes('$25.00'))
  assert.ok(fs.existsSync(path.join(env.LEASH_DIR, 'gate.mjs')))
  const settings = JSON.parse(fs.readFileSync(path.join(env.CLAUDE_CONFIG_DIR, 'settings.json'), 'utf8'))
  const flat = JSON.stringify(settings)
  assert.ok(flat.includes('gate.mjs'))
  assert.ok(flat.includes('PreToolUse'))

  // idempotent: re-install doesn't duplicate the hook
  execFileSync('node', [cli, 'guard', '--daily', '40'], { encoding: 'utf8', env })
  const settings2 = JSON.parse(fs.readFileSync(path.join(env.CLAUDE_CONFIG_DIR, 'settings.json'), 'utf8'))
  assert.equal(settings2.hooks.PreToolUse.length, 1)

  execFileSync('node', [cli, 'guard', '--off'], { encoding: 'utf8', env })
  const settings3 = JSON.parse(fs.readFileSync(path.join(env.CLAUDE_CONFIG_DIR, 'settings.json'), 'utf8'))
  assert.ok(!JSON.stringify(settings3).includes('gate.mjs'))
})

test('guard preserves existing user hooks', () => {
  const env = tmpEnv()
  const settingsPath = path.join(env.CLAUDE_CONFIG_DIR, 'settings.json')
  const existing = {
    hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo mine' }] }] },
    model: 'opus',
  }
  fs.writeFileSync(settingsPath, JSON.stringify(existing))
  execFileSync('node', [cli, 'guard', '--daily', '10'], { encoding: 'utf8', env })
  const after = JSON.parse(fs.readFileSync(settingsPath, 'utf8'))
  assert.equal(after.model, 'opus')
  assert.equal(after.hooks.PreToolUse.length, 2)
  assert.ok(JSON.stringify(after).includes('echo mine'))
  // pristine backup created
  assert.ok(fs.existsSync(settingsPath + '.pre-leash'))
})

test('gate blocks over budget (exit 2) and allows under budget (exit 0)', () => {
  const env = tmpEnv()
  execFileSync('node', [cli, 'guard', '--daily', '5'], { encoding: 'utf8', env })
  const gate = path.join(env.LEASH_DIR, 'gate.mjs')

  // Fresh cache saying we already spent $10 today → must block
  fs.writeFileSync(
    path.join(env.LEASH_DIR, 'cache.json'),
    JSON.stringify({ date: new Date().toISOString().slice(0, 10), spentUSD: 10, computedAt: Date.now() }),
  )
  const blocked = spawnSync('node', [gate], { encoding: 'utf8', env })
  assert.equal(blocked.status, 2)
  assert.ok(blocked.stderr.includes('daily budget'))

  // Cache saying we spent $1 → must allow
  fs.writeFileSync(
    path.join(env.LEASH_DIR, 'cache.json'),
    JSON.stringify({ date: new Date().toISOString().slice(0, 10), spentUSD: 1, computedAt: Date.now() }),
  )
  const allowed = spawnSync('node', [gate], { encoding: 'utf8', env })
  assert.equal(allowed.status, 0)
})

test('gate blocks on hourly burn-rate even under the daily cap', () => {
  const env = tmpEnv()
  execFileSync('node', [cli, 'guard', '--daily', '100', '--hourly', '5'], { encoding: 'utf8', env })
  const gate = path.join(env.LEASH_DIR, 'gate.mjs')
  // $8 in the last hour, only $8 today: daily cap fine, burn rate NOT fine
  fs.writeFileSync(
    path.join(env.LEASH_DIR, 'cache.json'),
    JSON.stringify({ date: new Date().toISOString().slice(0, 10), spentUSD: 8, hourUSD: 8, computedAt: Date.now() }),
  )
  const blocked = spawnSync('node', [gate], { encoding: 'utf8', env })
  assert.equal(blocked.status, 2)
  assert.ok(blocked.stderr.includes('burn-rate'))
})

test('guard --hourly alone keeps an existing daily cap', () => {
  const env = tmpEnv()
  execFileSync('node', [cli, 'guard', '--daily', '25'], { encoding: 'utf8', env })
  execFileSync('node', [cli, 'guard', '--hourly', '5'], { encoding: 'utf8', env })
  const config = JSON.parse(fs.readFileSync(path.join(env.LEASH_DIR, 'guard.json'), 'utf8'))
  assert.equal(config.dailyUSD, 25)
  assert.equal(config.hourlyUSD, 5)
})

test('gate fails OPEN when config is broken', () => {
  const env = tmpEnv()
  execFileSync('node', [cli, 'guard', '--daily', '5'], { encoding: 'utf8', env })
  const gate = path.join(env.LEASH_DIR, 'gate.mjs')
  fs.writeFileSync(path.join(env.LEASH_DIR, 'guard.json'), 'not json at all{{{')
  const res = spawnSync('node', [gate], { encoding: 'utf8', env })
  assert.equal(res.status, 0)
})
