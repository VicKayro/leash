import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import type { FleetReport, ScheduledAgent } from './types'

const useColor = process.stdout.isTTY && !process.env.NO_COLOR
const c = {
  bold: (s: string) => (useColor ? `\x1b[1m${s}\x1b[0m` : s),
  dim: (s: string) => (useColor ? `\x1b[2m${s}\x1b[0m` : s),
  red: (s: string) => (useColor ? `\x1b[31m${s}\x1b[0m` : s),
  green: (s: string) => (useColor ? `\x1b[32m${s}\x1b[0m` : s),
  yellow: (s: string) => (useColor ? `\x1b[33m${s}\x1b[0m` : s),
  cyan: (s: string) => (useColor ? `\x1b[36m${s}\x1b[0m` : s),
}

const usd = (n: number) => '$' + (n >= 100 ? Math.round(n).toLocaleString('en-US') : n.toFixed(2))
const num = (n: number) => n.toLocaleString('en-US')

function days(sec: number): string {
  if (sec >= 86400) return `${Math.round(sec / 86400)} days`
  if (sec >= 3600) return `${Math.round(sec / 3600)} hours`
  return `${Math.round(sec / 60)} minutes`
}

export function agentCount(r: FleetReport): number {
  return r.claude.projects.length + r.scheduled.filter((a) => !a.disabled).length
}

interface Action {
  title: string
  why: string
  cmd: string | null
}

// Single-quote a path for safe copy-pasting into a shell, even if the
// filename contains $(), backticks or quotes.
const shq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`

function buildActions(r: FleetReport): Action[] {
  const actions: Action[] = []
  for (const l of r.claude.loops) {
    actions.push({
      title: `A session in ${l.project} looped (${l.date})`,
      why: `${l.tool} ran ${l.count}×${l.spanMin ? ` in ${l.spanMin} min` : ''} with the exact same input — that's ~${usd(l.estCostUSD)} likely burned for nothing. Worth checking what happened before it repeats.`,
      cmd: `claude --resume ${l.sessionId}`,
    })
  }
  for (const a of r.scheduled) {
    if (a.disabled) continue
    if (a.zombie) {
      actions.push({
        title: `${a.label} is a zombie`,
        why: `It points to a script that no longer exists (${a.missingPath}). It will never run again — remove it or fix the path.`,
        cmd: a.plistPath ? `launchctl bootout gui/$(id -u) ${shq(a.plistPath)} 2>/dev/null; rm ${shq(a.plistPath)}` : null,
      })
    } else if (a.silentForSec !== null) {
      actions.push({
        title: `${a.label} looks dead`,
        why: `Its log hasn't moved in ${days(a.silentForSec)} even though it should run ${a.schedule}. Check what its last run said:`,
        cmd: a.logPath ? `tail -20 ${shq(a.logPath)}` : null,
      })
    } else if ((a.lastExitCode ?? 0) !== 0) {
      actions.push({
        title: `${a.label} failed its last run`,
        why: `It's still scheduled (${a.schedule}) but the last run crashed (exit code ${a.lastExitCode}). See why:`,
        cmd: a.logPath ? `tail -20 ${shq(a.logPath)}` : null,
      })
    } else if (!a.loaded && a.source === 'launchd') {
      actions.push({
        title: `${a.label} is not loaded`,
        why: `The schedule file exists (${a.schedule}) but macOS isn't running it. Load it:`,
        cmd: a.plistPath ? `launchctl bootstrap gui/$(id -u) ${shq(a.plistPath)}` : null,
      })
    }
  }
  for (const a of r.cloud) {
    const platform = KIND_LABELS[a.kind] ?? a.kind
    if (a.status === 'failing') {
      actions.push({
        title: `${cloudName(a)} is failing in the cloud`,
        why: `${platform}: ${a.note ?? 'last run failed'}. See it:`,
        cmd: a.url ?? null,
      })
    } else if (a.status === 'stale') {
      actions.push({
        title: `${cloudName(a)} stopped running`,
        why: `${platform}: ${a.note ?? 'no recent runs'}. Schedulers silently stop on inactive projects — check it:`,
        cmd: a.url ?? null,
      })
    } else if (a.status === 'disabled') {
      actions.push({
        title: `${cloudName(a)} is turned off in the cloud`,
        why: `${platform}: still defined, but the platform has it disabled (${a.note ?? 'disabled'}). Re-enable it:`,
        cmd: a.url ?? null,
      })
    }
  }
  return actions
}

const cloudName = (a: { repo: string; name: string }) =>
  a.name.startsWith('/') ? a.repo + a.name : `${a.repo}/${a.name}`

const KIND_LABELS: Record<string, string> = {
  'github-actions': 'GitHub Actions',
  'vercel-cron': 'Vercel cron',
  'render-cron': 'Render cron',
  railway: 'Railway',
  'cloudflare-worker': 'Cloudflare Worker',
}

export function warningCount(r: FleetReport): number {
  return buildActions(r).length
}

function agentStatus(a: ScheduledAgent): { icon: string; note: string } {
  if (a.zombie) return { icon: c.red('💀'), note: c.red('zombie — script is gone') }
  if (a.silentForSec !== null) return { icon: c.yellow('⚠'), note: c.yellow(`silent for ${days(a.silentForSec)}`) }
  if ((a.lastExitCode ?? 0) !== 0) return { icon: c.yellow('⚠'), note: c.yellow('last run failed') }
  if (!a.loaded && a.source === 'launchd') return { icon: c.yellow('⚠'), note: c.yellow('not running') }
  return { icon: c.green('✓'), note: c.dim(a.schedule) }
}

export function renderReport(r: FleetReport): string {
  const L: string[] = []
  const push = (s = '') => L.push(s)
  const actions = buildActions(r)
  const active = r.scheduled.filter((a) => !a.disabled)
  const disabled = r.scheduled.filter((a) => a.disabled)
  const totalAgents = r.claude.projects.length + active.length

  push()
  push(c.bold('🐕 leash') + c.dim(` · your agent fleet on this machine · last ${r.windowDays} days`))
  push()

  // ── The short version ────────────────────────────────────────────
  push('  ' + c.bold('The short version'))
  if (r.claude.available && r.claude.totalCostUSD > 0) {
    push(
      `  Your agents did ` +
        c.bold(usd(r.claude.totalCostUSD)) +
        ` worth of AI work across ${num(r.claude.totalSessions)} sessions.`,
    )
    push(
      c.dim(`  (That's the pay-as-you-go API value. On a subscription like Claude`),
    )
    push(c.dim(`  Pro/Max you paid a flat fee — this is what your usage is worth.)`))
  } else {
    push('  No Claude Code activity found on this machine in this window.')
  }
  if (totalAgents > 0) {
    const healthy = totalAgents - actions.length
    if (actions.length === 0) {
      push(`  ${c.bold(String(totalAgents))} agents live here and ` + c.green('all of them look fine right now.'))
    } else {
      push(
        `  ${c.bold(String(totalAgents))} agents live here: ${healthy} look fine, ` +
          c.yellow(c.bold(`${actions.length} need${actions.length === 1 ? 's' : ''} you`)) +
          ` (fixes below).`,
      )
    }
    if (r.cloud.length > 0) {
      const checked = r.cloud.filter((a) => a.status && a.status !== 'unknown').length
      push(
        `  Plus ${c.bold(String(r.cloud.length))} agents scheduled in the cloud ` +
          (checked > 0
            ? c.dim(`(${checked} checked live with your own platform logins).`)
            : c.dim('(found in your repos — health unknown from here).')),
      )
    }
  }

  // ── Money ────────────────────────────────────────────────────────
  if (r.claude.available && r.claude.projects.length > 0) {
    push()
    push('  ' + c.bold('Where the money went'))
    const top = r.claude.projects.slice(0, 8)
    const w = Math.max(...top.map((p) => p.name.length))
    for (const p of top) {
      push(
        '  ' +
          c.cyan(p.name.padEnd(w + 2)) +
          usd(p.costUSD).padStart(8) +
          c.dim(`  ${num(p.sessions)} session${p.sessions > 1 ? 's' : ''}`),
      )
    }
    const rest = r.claude.projects.length - top.length
    if (rest > 0) push(c.dim(`  … and ${rest} more active project${rest > 1 ? 's' : ''}`))
    if (r.claude.inactiveProjects > 0) {
      push(
        c.dim(
          `  ${r.claude.inactiveProjects} other project${r.claude.inactiveProjects > 1 ? 's' : ''} had no activity in the last ${r.windowDays} days (not counted).`,
        ),
      )
    }
    push(c.dim(`  "~ (home)" = sessions started from your home folder rather than a project.`))
  }

  // ── Your month in agents (the mirror — interesting even when healthy) ──
  const ins = r.claude.insights
  if (r.claude.available && r.claude.totalSessions > 0) {
    push()
    push('  ' + c.bold(`Your ${r.windowDays >= 28 ? 'month' : `${r.windowDays} days`} in agents`))
    if (ins.nightSessions > 0) {
      push(
        `  🌙 ${c.bold(num(ins.nightSessions))} session${ins.nightSessions > 1 ? 's' : ''} ran between midnight and 7am` +
          c.dim(' — your agents work while you sleep'),
      )
    }
    if (ins.activeDays > 0) {
      push(`  📅 Agents active ${c.bold(String(ins.activeDays))} of the last ${r.windowDays} days`)
    }
    if (ins.totalToolCalls > 0) {
      const tools = ins.topTools.map((t) => `${t.tool} ×${num(t.count)}`).join(' · ')
      push(`  🔧 ${c.bold(num(ins.totalToolCalls))} tool calls` + (tools ? c.dim(`  (${tools})`) : ''))
    }
    if (ins.topSession && ins.topSession.costUSD >= 1) {
      push(
        `  💸 Biggest single session: ${c.bold(usd(ins.topSession.costUSD))} in ${ins.topSession.project} on ${ins.topSession.date}`,
      )
    }
    const roi =
      r.claude.totalCostUSD >= 250
        ? { plan: 'a $200/mo Max subscription', mult: r.claude.totalCostUSD / 200 }
        : r.claude.totalCostUSD >= 40
          ? { plan: 'a $20/mo Pro subscription', mult: r.claude.totalCostUSD / 20 }
          : null
    if (roi) {
      push(
        `  📈 ${usd(r.claude.totalCostUSD)} of API value ≈ ${c.bold(`${roi.mult.toFixed(roi.mult >= 10 ? 0 : 1)}×`)} the price of ${roi.plan}`,
      )
    }
  }

  // ── Scheduled agents ─────────────────────────────────────────────
  push()
  push(
    '  ' +
      c.bold('Your scheduled agents') +
      c.dim(` · ${active.length} active${disabled.length ? ` · ${disabled.length} turned off on purpose` : ''}`),
  )
  for (const a of active) {
    const { icon, note } = agentStatus(a)
    push(`  ${icon} ${a.label}  ${note}`)
  }
  if (disabled.length) push(c.dim(`  ○ turned off: ${disabled.map((a) => a.label.replace(/^com\.[^.]+\./, '')).join(', ')}`))

  // ── Cloud-scheduled agents (defined in local repos) ──────────────
  if (r.cloud.length > 0) {
    const checked = r.cloud.filter((a) => a.status && a.status !== 'unknown').length
    // Problems first, then the healthy tail.
    const order = { failing: 0, disabled: 1, stale: 2, unknown: 3, ok: 4 } as const
    const sorted = [...r.cloud].sort(
      (a, b) => order[a.status ?? 'unknown'] - order[b.status ?? 'unknown'],
    )
    push()
    push('  ' + c.bold('Cloud-scheduled agents found in your repos') + c.dim(` · ${r.cloud.length}`))
    for (const a of sorted.slice(0, 12)) {
      const kind = KIND_LABELS[a.kind] ?? a.kind
      const icon =
        a.status === 'ok' ? c.green('✓') :
        a.status === 'failing' ? c.red('✗') :
        a.status === 'disabled' || a.status === 'stale' ? c.yellow('⚠') :
        c.dim('⟳')
      const note = a.status && a.status !== 'unknown'
        ? (a.status === 'ok' ? c.dim(a.note ?? 'ok') : c.yellow(a.note ?? a.status))
        : c.dim(`${kind}${a.schedule ? ` · ${a.schedule}` : ''}`)
      push(`  ${icon} ${cloudName(a)}  ${note}`)
    }
    if (r.cloud.length > 12) push(c.dim(`  … and ${r.cloud.length - 12} more`))
    if (checked === 0) {
      push(c.dim('  Health unknown from here. leash can check these live with your own'))
      push(c.dim('  platform logins (read-only, direct to each platform): ') + c.cyan('npx getleash link'))
    } else if (checked < r.cloud.length) {
      push(c.dim(`  ${r.cloud.length - checked} not checked — platform not linked or repo not pushed.`))
      push(c.dim('  Connect more platforms: ') + c.cyan('npx getleash link') + c.dim(' · skip all checks: --offline'))
    }
  }

  // ── Fixes ────────────────────────────────────────────────────────
  push()
  if (actions.length > 0) {
    push('  ' + c.bold(c.yellow(`To fix (${actions.length}) — copy-paste the command under each one`)))
    actions.forEach((a, i) => {
      push()
      push(`  ${i + 1}. ` + c.bold(a.title))
      push('     ' + a.why)
      if (a.cmd) push('     ' + c.cyan(a.cmd))
    })
  } else {
    push('  ' + c.green('Nothing to fix. ') + c.dim('Enjoy it while it lasts.'))
  }

  // ── One next step, chosen from THEIR data — not a menu ──────────
  let guardOn = false
  try {
    const leashDir = process.env.LEASH_DIR || path.join(os.homedir(), '.leash')
    const cfg = JSON.parse(fs.readFileSync(path.join(leashDir, 'guard.json'), 'utf8'))
    guardOn = !!(cfg.dailyUSD || cfg.hourlyUSD)
  } catch {}
  const liveNow = r.claude.projects.some((p) => Date.now() - p.lastActivity < 5 * 60_000)

  push()
  if (!guardOn && r.claude.totalCostUSD > 5) {
    // Personalized caps: ~2x their average day, hourly ≈ a quarter of that.
    const daily = Math.max(5, Math.ceil(((r.claude.totalCostUSD / r.windowDays) * 2) / 5) * 5)
    const hourly = Math.max(5, Math.ceil(daily / 4 / 5) * 5)
    const reason = r.claude.loops.length
      ? `You had ${r.claude.loops.length} loop${r.claude.loops.length > 1 ? 's' : ''} this month and no spending cap.`
      : `You spend ~${usd(r.claude.totalCostUSD / r.windowDays)}/day with no cap. Claude Code has none built in.`
    push('  ' + c.bold('Next: ') + reason + ' Based on your usage:')
    push('  ' + c.cyan(`npx getleash guard --daily ${daily} --hourly ${hourly}`))
  } else if (liveNow) {
    push('  ' + c.bold('Next: ') + `an agent is running right now — watch its cost tick live:`)
    push('  ' + c.cyan('npx getleash watch'))
  } else {
    let fleet: any = null
    try {
      const leashDir = process.env.LEASH_DIR || path.join(os.homedir(), '.leash')
      fleet = JSON.parse(fs.readFileSync(path.join(leashDir, 'cloud.json'), 'utf8'))
    } catch {}
    if (fleet?.token) {
      push('  ' + c.bold('Next: ') + 'fresh data just pushed — your fleet dashboard:')
      push('  ' + c.cyan(`${fleet.url || 'https://getleash.vercel.app'}/f/${fleet.token}`))
    } else {
      push('  ' + c.bold('Next: ') + 'put your whole fleet on one page — free, no signup:')
      push('  ' + c.cyan('npx getleash connect'))
    }
  }
  push()
  if (r.cloud.some((a) => a.status && a.status !== 'unknown')) {
    push(c.dim('  Cloud agents checked live with your own platform logins (') + c.cyan('npx getleash link') + c.dim(').'))
    push(c.dim('  Share your fleet card: ') + c.cyan('npx getleash --share'))
  } else {
    push(c.dim('  This machine only — cloud agents (GitHub Actions, Vercel…) are invisible'))
    push(c.dim('  from here until you connect them: ') + c.cyan('npx getleash link'))
  }
  push()
  return L.join('\n')
}

export function renderShareCard(r: FleetReport): string {
  const agents = agentCount(r) + r.cloud.length
  const zombies = r.scheduled.filter((a) => a.zombie).length
  const loops = r.claude.loops.length
  const night = r.claude.insights.nightSessions
  const lines = [
    `My agent fleet 🐕`,
    `${agents} agents · ${usd(r.claude.totalCostUSD)} in ${r.windowDays} days`,
    ...(night > 0 ? [`${num(night)} sessions ran while I slept`] : []),
    `${loops} loop${loops === 1 ? '' : 's'} caught · ${zombies} zombie cron${zombies === 1 ? '' : 's'}`,
    ``,
    `npx getleash`,
  ]
  const w = Math.max(...lines.map((l) => l.length))
  const top = '┌' + '─'.repeat(w + 2) + '┐'
  const bot = '└' + '─'.repeat(w + 2) + '┘'
  return ['', top, ...lines.map((l) => `│ ${l.padEnd(w)} │`), bot, ''].join('\n')
}
