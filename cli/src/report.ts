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

function buildActions(r: FleetReport): Action[] {
  const actions: Action[] = []
  for (const l of r.claude.loops) {
    actions.push({
      title: `A session in ${l.project} looped (${l.date})`,
      why: `${l.tool} ran ${l.count}× with the exact same input — that's ~${usd(l.estCostUSD)} likely burned for nothing. Worth checking what happened before it repeats.`,
      cmd: `claude --resume ${l.sessionId}`,
    })
  }
  for (const a of r.scheduled) {
    if (a.disabled) continue
    if (a.zombie) {
      actions.push({
        title: `${a.label} is a zombie`,
        why: `It points to a script that no longer exists (${a.missingPath}). It will never run again — remove it or fix the path.`,
        cmd: a.plistPath ? `launchctl bootout gui/$(id -u) "${a.plistPath}" 2>/dev/null; rm "${a.plistPath}"` : null,
      })
    } else if (a.silentForSec !== null) {
      actions.push({
        title: `${a.label} looks dead`,
        why: `Its log hasn't moved in ${days(a.silentForSec)} even though it should run ${a.schedule}. Check what its last run said:`,
        cmd: a.logPath ? `tail -20 "${a.logPath}"` : null,
      })
    } else if ((a.lastExitCode ?? 0) !== 0) {
      actions.push({
        title: `${a.label} failed its last run`,
        why: `It's still scheduled (${a.schedule}) but the last run crashed (exit code ${a.lastExitCode}). See why:`,
        cmd: a.logPath ? `tail -20 "${a.logPath}"` : null,
      })
    } else if (!a.loaded && a.source === 'launchd') {
      actions.push({
        title: `${a.label} is not loaded`,
        why: `The schedule file exists (${a.schedule}) but macOS isn't running it. Load it:`,
        cmd: a.plistPath ? `launchctl bootstrap gui/$(id -u) "${a.plistPath}"` : null,
      })
    }
  }
  return actions
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

  // ── Scope + CTA ──────────────────────────────────────────────────
  push()
  push(
    c.dim('  Heads-up: leash only sees THIS machine. Agents running in the cloud'),
  )
  push(
    c.dim('  (GitHub Actions, Vercel crons, servers) are invisible here — watching'),
  )
  push(c.dim('  those too is what leash cloud is for: ') + c.cyan('npx getleash connect'))
  push(c.dim('  Share your fleet card: ') + c.cyan('npx getleash --share'))
  push()
  return L.join('\n')
}

export function renderShareCard(r: FleetReport): string {
  const agents = agentCount(r)
  const zombies = r.scheduled.filter((a) => a.zombie).length
  const loops = r.claude.loops.length
  const lines = [
    `My agent fleet 🐕`,
    `${agents} agents · ${usd(r.claude.totalCostUSD)} in ${r.windowDays} days`,
    `${loops} loop${loops === 1 ? '' : 's'} caught · ${zombies} zombie cron${zombies === 1 ? '' : 's'}`,
    ``,
    `npx getleash`,
  ]
  const w = Math.max(...lines.map((l) => l.length))
  const top = '┌' + '─'.repeat(w + 2) + '┐'
  const bot = '└' + '─'.repeat(w + 2) + '┘'
  return ['', top, ...lines.map((l) => `│ ${l.padEnd(w)} │`), bot, ''].join('\n')
}
