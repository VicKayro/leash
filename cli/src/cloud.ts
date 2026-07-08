import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import * as crypto from 'node:crypto'
import { scanClaude } from './scan/claude'
import { scanLaunchd } from './scan/launchd'
import { scanCron } from './scan/cron'
import { scanSystemd } from './scan/systemd'
import { scanCloud } from './scan/cloud'
import type { FleetReport, ScheduledAgent } from './types'

export const CLOUD_URL = process.env.LEASH_CLOUD_URL || 'https://getleash.vercel.app'

const LEASH_DIR = process.env.LEASH_DIR || path.join(os.homedir(), '.leash')
const CLOUD_CONFIG = () => path.join(LEASH_DIR, 'cloud.json')
const SETTINGS = () =>
  path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'settings.json')

// The hook prefers a globally installed getleash (instant) and falls back to npx.
const PUSH_HOOK_CMD = 'getleash push --quiet 2>/dev/null || npx -y getleash push --quiet'

interface CloudConfig {
  token: string
  url: string
}

export function readCloudConfig(): CloudConfig | null {
  try {
    const c = JSON.parse(fs.readFileSync(CLOUD_CONFIG(), 'utf8'))
    if (typeof c.token === 'string' && /^flt_[a-f0-9]{16,64}$/.test(c.token)) {
      return { token: c.token, url: typeof c.url === 'string' ? c.url : CLOUD_URL }
    }
  } catch {}
  return null
}

function machineId(): string {
  return crypto
    .createHash('sha256')
    .update(os.hostname() + ':' + os.userInfo().username)
    .digest('hex')
    .slice(0, 12)
}

function cliVersion(): string {
  try {
    return require('../package.json').version
  } catch {
    return '?'
  }
}

function scheduledProblem(a: ScheduledAgent): string | null {
  if (a.disabled) return null
  if (a.zombie) return 'zombie'
  if (a.lastExitCode !== null && a.lastExitCode !== 0) return 'failing'
  if (!a.loaded) return 'not loaded'
  if (a.silentForSec !== null) return 'silent'
  return null
}

// Compact, metrics-only snapshot. Never includes file paths, prompts or contents.
export function buildSnapshot(report: FleetReport): any {
  let guard: { dailyUSD?: number; hourlyUSD?: number } | null = null
  try {
    const config = JSON.parse(fs.readFileSync(path.join(LEASH_DIR, 'guard.json'), 'utf8'))
    const hooked = fs.readFileSync(SETTINGS(), 'utf8').includes('gate.mjs')
    if (hooked && (config.dailyUSD || config.hourlyUSD)) guard = config
  } catch {}

  const issues = report.scheduled
    .map((a) => ({ a, problem: scheduledProblem(a) }))
    .filter((x) => x.problem)
    .slice(0, 20)
    .map(({ a, problem }) => ({ label: a.label, source: a.source, schedule: a.schedule, problem }))

  return {
    v: 1,
    generatedAt: report.generatedAt,
    windowDays: report.windowDays,
    totals: {
      costUSD: round2(report.claude.totalCostUSD),
      sessions: report.claude.totalSessions,
      projects: report.claude.projects.length,
    },
    insights: {
      nightSessions: report.claude.insights.nightSessions,
      activeDays: report.claude.insights.activeDays,
      totalToolCalls: report.claude.insights.totalToolCalls,
      topTools: report.claude.insights.topTools.slice(0, 3),
    },
    topProjects: [...report.claude.projects]
      .sort((a, b) => b.costUSD - a.costUSD)
      .slice(0, 8)
      .map((p) => ({
        name: p.name || p.dir.split('-').slice(-1)[0],
        costUSD: round2(p.costUSD),
        sessions: p.sessions,
        lastActivity: p.lastActivity,
      })),
    loops: report.claude.loops.slice(0, 10).map((l) => ({
      project: l.project,
      tool: l.tool,
      count: l.count,
      date: l.date,
      estCostUSD: round2(l.estCostUSD),
    })),
    scheduled: { total: report.scheduled.filter((a) => !a.disabled).length, issues },
    cloudAgents: {
      total: report.cloud.length,
      githubActions: report.cloud.filter((c) => c.kind === 'github-actions').length,
      vercelCrons: report.cloud.filter((c) => c.kind === 'vercel-cron').length,
    },
    guard,
  }
}

const round2 = (n: number) => Math.round(n * 100) / 100

async function fullScan(windowDays = 30): Promise<FleetReport> {
  const [claude, launchd, cron, systemd] = await Promise.all([
    scanClaude(windowDays),
    Promise.resolve().then(scanLaunchd),
    Promise.resolve().then(scanCron),
    Promise.resolve().then(scanSystemd),
  ])
  return {
    generatedAt: new Date().toISOString(),
    windowDays,
    claude,
    scheduled: [...launchd, ...systemd, ...cron],
    cloud: scanCloud(claude.projects.map((p) => p.cwd)),
  }
}

export async function pushReport(report: FleetReport, config: CloudConfig): Promise<void> {
  const res = await fetch(config.url + '/api/ingest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      token: config.token,
      machine: {
        id: machineId(),
        host: os.hostname(),
        platform: process.platform,
        cliVersion: cliVersion(),
      },
      snapshot: buildSnapshot(report),
    }),
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) throw new Error(`cloud replied ${res.status}`)
}

export async function pushCommand(args: string[]): Promise<void> {
  const quiet = args.includes('--quiet')
  const config = readCloudConfig()
  if (!config) {
    if (!quiet) {
      console.error('leash: not connected. Run `npx getleash connect` first.')
      process.exitCode = 1
    }
    return
  }
  try {
    await pushReport(await fullScan(), config)
    if (!quiet) console.log(`\nPushed. Fleet dashboard: ${config.url}/f/${config.token}\n`)
  } catch (err: any) {
    // Fail-open in --quiet: a hook must never bother the user because wifi is off.
    if (!quiet) {
      console.error('leash: push failed —', err?.message ?? err)
      process.exitCode = 1
    }
  }
}

function readSettings(): any {
  try {
    return JSON.parse(fs.readFileSync(SETTINGS(), 'utf8'))
  } catch {
    return {}
  }
}

function writeSettings(settings: any): void {
  const file = SETTINGS()
  const backup = file + '.pre-leash'
  if (fs.existsSync(file) && !fs.existsSync(backup)) fs.copyFileSync(file, backup)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(settings, null, 2) + '\n')
}

function removePushHook(settings: any): void {
  const entries = settings?.hooks?.SessionEnd
  if (!Array.isArray(entries)) return
  settings.hooks.SessionEnd = entries.filter(
    (entry: any) =>
      !(
        Array.isArray(entry?.hooks) &&
        entry.hooks.some((h: any) => String(h?.command || '').includes('getleash push'))
      ),
  )
  if (settings.hooks.SessionEnd.length === 0) delete settings.hooks.SessionEnd
  if (Object.keys(settings.hooks).length === 0) delete settings.hooks
}

function installPushHook(): void {
  const settings = readSettings()
  removePushHook(settings) // idempotent re-install
  settings.hooks = settings.hooks || {}
  settings.hooks.SessionEnd = settings.hooks.SessionEnd || []
  settings.hooks.SessionEnd.push({ hooks: [{ type: 'command', command: PUSH_HOOK_CMD }] })
  writeSettings(settings)
}

export async function connectCommand(args: string[]): Promise<void> {
  if (args.includes('--off')) {
    const settings = readSettings()
    removePushHook(settings)
    writeSettings(settings)
    try {
      fs.rmSync(CLOUD_CONFIG())
    } catch {}
    console.log('\nleash cloud is OFF — hook removed, fleet token deleted locally.\n')
    return
  }

  const fleetIdx = args.indexOf('--fleet')
  const joined = fleetIdx >= 0 ? String(args[fleetIdx + 1] || '') : null
  if (joined !== null && !/^flt_[a-f0-9]{16,64}$/.test(joined)) {
    console.error('leash: invalid fleet token (expected flt_…). Copy it from your dashboard footer.')
    process.exitCode = 1
    return
  }

  const existing = readCloudConfig()
  const token = joined ?? existing?.token ?? 'flt_' + crypto.randomBytes(12).toString('hex')
  const config: CloudConfig = { token, url: CLOUD_URL }
  fs.mkdirSync(LEASH_DIR, { recursive: true })
  fs.writeFileSync(CLOUD_CONFIG(), JSON.stringify(config, null, 2) + '\n')

  process.stdout.write('\nScanning this machine… ')
  try {
    await pushReport(await fullScan(), config)
    console.log('pushed.')
  } catch (err: any) {
    console.log(`push failed (${err?.message ?? err}) — will retry on next session end.`)
  }

  if (!args.includes('--no-hook')) installPushHook()

  console.log(`
leash cloud is ON. Your private fleet dashboard:

  ${config.url}/f/${config.token}

${joined ? 'This machine joined an existing fleet.' : existing ? 'Reconnected with your existing fleet token.' : 'Keep that URL to yourself — anyone with it can see your fleet metrics.'}
${args.includes('--no-hook') ? '' : `A SessionEnd hook now refreshes the dashboard after each Claude Code session.\n`}
  Add another machine:  npx -y getleash connect --fleet ${config.token}
  Push manually:        npx getleash push
  Disconnect:           npx getleash connect --off

Metrics only: costs, counts, agent health. Never prompts, transcripts or file contents.
`)
}
