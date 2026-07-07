import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const cli = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'index.js')
const run = (...args) => execFileSync('node', [cli, ...args], { encoding: 'utf8' })

test('--json outputs a valid fleet report', () => {
  const report = JSON.parse(run('--json'))
  assert.equal(typeof report.generatedAt, 'string')
  assert.equal(typeof report.windowDays, 'number')
  assert.equal(typeof report.claude.totalCostUSD, 'number')
  assert.ok(Array.isArray(report.claude.projects))
  assert.ok(Array.isArray(report.claude.loops))
  assert.ok(Array.isArray(report.scheduled))
  assert.ok(Array.isArray(report.cloud))
  for (const p of report.claude.projects) {
    assert.ok(p.costUSD >= 0, 'cost must be non-negative')
  }
})

test('default report renders the summary', () => {
  const out = run()
  assert.ok(out.includes('The short version'))
  assert.ok(out.includes('leash'))
})

test('--share renders the fleet card', () => {
  const out = run('--share')
  assert.ok(out.includes('npx getleash'))
  assert.ok(out.includes('My agent fleet'))
})

test('--days changes the window', () => {
  const report = JSON.parse(run('--json', '--days', '7'))
  assert.equal(report.windowDays, 7)
})

test('--help shows usage without scanning', () => {
  const out = run('--help')
  assert.ok(out.includes('Usage'))
})
