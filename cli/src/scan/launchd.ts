import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { execFileSync } from 'node:child_process'
import type { ScheduledAgent } from '../types'

// Software updaters and vendor helpers are not the user's agents.
const VENDOR_PREFIXES = [
  'com.apple.',
  'com.google.',
  'com.microsoft.',
  'com.adobe.',
  'com.dropbox.',
  'com.spotify.',
  'com.barco.',
  'com.imobie.',
  'com.docker.',
  'us.zoom.',
  'com.brave.',
  'org.mozilla.',
]

function plistToJson(file: string): any | null {
  try {
    const out = execFileSync('plutil', ['-convert', 'json', '-o', '-', file], {
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
    })
    return JSON.parse(out)
  } catch {
    return null
  }
}

function launchctlStatus(): Map<string, { pid: number | null; lastExit: number | null }> {
  const map = new Map<string, { pid: number | null; lastExit: number | null }>()
  try {
    const out = execFileSync('launchctl', ['list'], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 })
    for (const line of out.split('\n').slice(1)) {
      const [pid, status, label] = line.trim().split(/\t/)
      if (!label) continue
      map.set(label, {
        pid: pid === '-' ? null : Number(pid),
        lastExit: status === '-' ? null : Number(status),
      })
    }
  } catch {
    // launchctl unavailable (non-macOS): return empty map
  }
  return map
}

function describeSchedule(p: any): { text: string; intervalSec: number | null } {
  if (typeof p.StartInterval === 'number') {
    const s = p.StartInterval
    const text = s % 3600 === 0 ? `every ${s / 3600}h` : s % 60 === 0 ? `every ${s / 60}min` : `every ${s}s`
    return { text, intervalSec: s }
  }
  const cal = p.StartCalendarInterval
  if (cal) {
    const c = Array.isArray(cal) ? cal[0] : cal
    if (c && typeof c === 'object') {
      if ('Weekday' in c) return { text: 'weekly', intervalSec: 7 * 86400 }
      if ('Day' in c) return { text: 'monthly', intervalSec: 30 * 86400 }
      if ('Hour' in c) {
        const h = String(c.Hour).padStart(2, '0')
        const m = String(c.Minute ?? 0).padStart(2, '0')
        return { text: `daily at ${h}:${m}`, intervalSec: 86400 }
      }
      if ('Minute' in c) return { text: `hourly at :${String(c.Minute).padStart(2, '0')}`, intervalSec: 3600 }
    }
    return { text: 'calendar', intervalSec: 86400 }
  }
  if (p.KeepAlive) return { text: 'daemon (keep-alive)', intervalSec: null }
  if (p.RunAtLoad) return { text: 'at login', intervalSec: null }
  return { text: 'manual', intervalSec: null }
}

function findMissingScript(p: any): string | null {
  const args: string[] = Array.isArray(p.ProgramArguments)
    ? p.ProgramArguments
    : p.Program
      ? [p.Program]
      : []
  for (const a of args) {
    if (typeof a !== 'string' || !a.startsWith('/')) continue
    // Only flag things that look like user scripts, not system binaries.
    if (a.startsWith('/usr/') || a.startsWith('/bin/') || a.startsWith('/sbin/') || a.startsWith('/opt/')) continue
    if (!fs.existsSync(a)) return a
  }
  return null
}

function silentFor(p: any, intervalSec: number | null): number | null {
  if (!intervalSec) return null
  const log = p.StandardOutPath || p.StandardErrorPath
  if (!log || typeof log !== 'string') return null
  try {
    const ageSec = (Date.now() - fs.statSync(log).mtimeMs) / 1000
    // Twice the expected interval (plus an hour of slack) = something is wrong.
    if (ageSec > intervalSec * 2 + 3600) return Math.round(ageSec)
  } catch {
    return null // no log yet — can't tell
  }
  return null
}

export function scanLaunchd(): ScheduledAgent[] {
  const dir = path.join(os.homedir(), 'Library', 'LaunchAgents')
  if (!fs.existsSync(dir)) return []
  const status = launchctlStatus()
  const agents: ScheduledAgent[] = []

  for (const f of fs.readdirSync(dir)) {
    const disabled = f.endsWith('.plist.disabled')
    if (!f.endsWith('.plist') && !disabled) continue
    const p = plistToJson(path.join(dir, f))
    if (!p) continue
    const label: string = p.Label || f.replace(/\.plist(\.disabled)?$/, '')
    if (VENDOR_PREFIXES.some((v) => label.startsWith(v))) continue

    const { text, intervalSec } = describeSchedule(p)
    const st = status.get(label)
    const missingPath = findMissingScript(p)
    const logPath = p.StandardErrorPath || p.StandardOutPath || null
    agents.push({
      label,
      source: 'launchd',
      schedule: text,
      intervalSec,
      loaded: !!st,
      disabled,
      lastExitCode: st?.lastExit ?? null,
      zombie: missingPath !== null,
      missingPath,
      silentForSec: disabled ? null : silentFor(p, intervalSec),
      plistPath: path.join(dir, f),
      logPath: typeof logPath === 'string' ? logPath : null,
    })
  }
  return agents
}
