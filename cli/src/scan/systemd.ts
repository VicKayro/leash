import { execFileSync } from 'node:child_process'
import type { ScheduledAgent } from '../types'

function run(args: string[]): string | null {
  try {
    return execFileSync('systemctl', args, { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] })
  } catch {
    return null
  }
}

// Linux support is best-effort (beta): user timers only, degrade to nothing on error.
export function scanSystemd(): ScheduledAgent[] {
  if (process.platform !== 'linux') return []

  const agents: ScheduledAgent[] = []
  const failedUnits = new Set<string>()
  const failedOut = run(['--user', '--failed', '--plain', '--no-legend'])
  if (failedOut) {
    for (const line of failedOut.split('\n')) {
      const unit = line.trim().split(/\s+/)[0]
      if (unit) failedUnits.add(unit)
    }
  }

  const out = run(['--user', 'list-timers', '--all', '--plain', '--no-legend'])
  if (!out) return []
  for (const line of out.split('\n')) {
    const cols = line.trim().split(/\s{2,}/)
    if (cols.length < 2) continue
    // Format: NEXT  LEFT  LAST  PASSED  UNIT  ACTIVATES (whitespace-separated blocks)
    const unit = cols.find((c) => c.endsWith('.timer'))
    const activates = cols.find((c) => c.endsWith('.service'))
    if (!unit) continue
    const failed = activates ? failedUnits.has(activates) : false
    agents.push({
      label: unit.replace(/\.timer$/, ''),
      source: 'systemd',
      schedule: 'systemd timer',
      intervalSec: null,
      loaded: true,
      disabled: false,
      lastExitCode: failed ? 1 : 0,
      zombie: false,
      missingPath: null,
      silentForSec: null,
      plistPath: null,
      logPath: null,
    })
  }
  return agents
}
