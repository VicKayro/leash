import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { GATE_SOURCE } from './gate-source'

const LEASH_DIR = process.env.LEASH_DIR || path.join(os.homedir(), '.leash')
const SETTINGS = path.join(
  process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'),
  'settings.json',
)
const GATE_PATH = path.join(LEASH_DIR, 'gate.mjs')

// Recognize our own hook entry: the exact installed path, or any leash gate
// left over from a previous LEASH_DIR.
function isOurCommand(cmd: string): boolean {
  return cmd.includes(GATE_PATH) || (/gate\.mjs/.test(cmd) && /leash/i.test(cmd))
}

function readSettings(): any {
  try {
    return JSON.parse(fs.readFileSync(SETTINGS, 'utf8'))
  } catch {
    return {}
  }
}

function writeSettings(settings: any): void {
  // One-time backup of the pristine file, never overwritten after.
  const backup = SETTINGS + '.pre-leash'
  if (fs.existsSync(SETTINGS) && !fs.existsSync(backup)) fs.copyFileSync(SETTINGS, backup)
  fs.mkdirSync(path.dirname(SETTINGS), { recursive: true })
  fs.writeFileSync(SETTINGS, JSON.stringify(settings, null, 2) + '\n')
}

function removeOurHooks(settings: any): void {
  const pre = settings?.hooks?.PreToolUse
  if (!Array.isArray(pre)) return
  settings.hooks.PreToolUse = pre.filter(
    (entry: any) =>
      !(Array.isArray(entry?.hooks) && entry.hooks.some((h: any) => isOurCommand(String(h?.command || '')))),
  )
  if (settings.hooks.PreToolUse.length === 0) delete settings.hooks.PreToolUse
  if (Object.keys(settings.hooks).length === 0) delete settings.hooks
}

function capLine(config: { dailyUSD?: number; hourlyUSD?: number }): string {
  const parts: string[] = []
  if (config.dailyUSD) parts.push(`$${config.dailyUSD.toFixed(2)}/day`)
  if (config.hourlyUSD) parts.push(`$${config.hourlyUSD.toFixed(2)}/hour (burn-rate)`)
  return parts.join(' · ')
}

export function guardOn(dailyUSD: number | null, hourlyUSD: number | null): void {
  // Merge with any existing config so `--hourly 5` doesn't wipe the daily cap.
  let config: { dailyUSD?: number; hourlyUSD?: number } = {}
  try {
    config = JSON.parse(fs.readFileSync(path.join(LEASH_DIR, 'guard.json'), 'utf8'))
  } catch {}
  if (dailyUSD !== null) config.dailyUSD = dailyUSD
  if (hourlyUSD !== null) config.hourlyUSD = hourlyUSD

  fs.mkdirSync(LEASH_DIR, { recursive: true })
  fs.writeFileSync(GATE_PATH, GATE_SOURCE)
  fs.writeFileSync(path.join(LEASH_DIR, 'guard.json'), JSON.stringify(config, null, 2) + '\n')

  const settings = readSettings()
  removeOurHooks(settings) // idempotent re-install
  settings.hooks = settings.hooks || {}
  settings.hooks.PreToolUse = settings.hooks.PreToolUse || []
  settings.hooks.PreToolUse.push({
    matcher: '*',
    hooks: [{ type: 'command', command: `node "${GATE_PATH}"` }],
  })
  writeSettings(settings)

  console.log(`
leash budget guard is ON — ${capLine(config)}

How it works: a Claude Code PreToolUse hook checks your estimated spend
(local transcripts, cached 2 min). Over a cap, tool calls are BLOCKED with
a clear message. The hourly cap catches runaway loops long before the daily
one would. Fail-open: if anything breaks, Claude Code works normally.

  Status:  getleash guard --status
  Change:  getleash guard --daily <amount> and/or --hourly <amount>
  Off:     getleash guard --off
`)
}

export function guardOff(): void {
  const settings = readSettings()
  removeOurHooks(settings)
  writeSettings(settings)
  try {
    fs.rmSync(path.join(LEASH_DIR, 'guard.json'))
  } catch {}
  console.log('\nleash budget guard is OFF. (Your settings backup: settings.json.pre-leash)\n')
}

export function guardStatus(): void {
  let config: any = null
  try {
    config = JSON.parse(fs.readFileSync(path.join(LEASH_DIR, 'guard.json'), 'utf8'))
  } catch {}
  const hooked = JSON.stringify(readSettings()).includes('gate.mjs')

  if (!config || !hooked) {
    console.log(`
leash budget guard is OFF.

Claude Code has no native spend limit. Set hard caps in one command:
  getleash guard --daily 25 --hourly 5
`)
    return
  }

  let spentLine = 'not computed yet (runs on the next tool call)'
  try {
    const cache = JSON.parse(fs.readFileSync(path.join(LEASH_DIR, 'cache.json'), 'utf8'))
    if (cache.date === new Date().toISOString().slice(0, 10)) {
      spentLine = `$${cache.spentUSD.toFixed(2)} spent today, $${(cache.hourUSD ?? 0).toFixed(2)} in the last hour (estimated)`
    }
  } catch {}
  console.log(`
leash budget guard is ON — ${capLine(config)}
${spentLine}

  Change:  getleash guard --daily <amount> and/or --hourly <amount>
  Off:     getleash guard --off
`)
}

function amountAfter(args: string[], flag: string): number | null | 'invalid' {
  const idx = args.indexOf(flag)
  if (idx < 0) return null
  const amount = Number(args[idx + 1])
  if (!Number.isFinite(amount) || amount <= 0) return 'invalid'
  return amount
}

export function guardCommand(args: string[]): void {
  if (args.includes('--off')) return guardOff()
  const daily = amountAfter(args, '--daily')
  const hourly = amountAfter(args, '--hourly')
  if (daily === 'invalid' || hourly === 'invalid') {
    console.error('leash: caps need a positive amount, e.g. getleash guard --daily 25 --hourly 5')
    process.exitCode = 1
    return
  }
  if (daily !== null || hourly !== null) return guardOn(daily, hourly)
  return guardStatus()
}
