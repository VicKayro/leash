import * as fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import type { ScheduledAgent } from '../types'

export function scanCron(): ScheduledAgent[] {
  let out: string
  try {
    out = execFileSync('crontab', ['-l'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  } catch {
    return [] // no crontab for this user
  }

  const agents: ScheduledAgent[] = []
  for (const raw of out.split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#') || line.includes('=')) continue
    const m = line.match(/^(\S+\s+\S+\s+\S+\s+\S+\s+\S+)\s+(.+)$/)
    if (!m) continue
    const [, schedule, command] = m
    const scriptPath = command.split(/\s+/).find((t) => t.startsWith('/') && /\.(sh|py|js|ts|rb)$/.test(t))
    agents.push({
      label: command.length > 60 ? command.slice(0, 57) + '…' : command,
      source: 'cron',
      schedule,
      intervalSec: null,
      loaded: true,
      disabled: false,
      lastExitCode: null,
      zombie: scriptPath ? !fs.existsSync(scriptPath) : false,
      missingPath: scriptPath && !fs.existsSync(scriptPath) ? scriptPath : null,
      silentForSec: null,
      plistPath: null,
      logPath: null,
    })
  }
  return agents
}
