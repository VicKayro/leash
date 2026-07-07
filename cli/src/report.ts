import type { FleetReport } from './types'

const useColor = process.stdout.isTTY && !process.env.NO_COLOR
const c = {
  bold: (s: string) => (useColor ? `\x1b[1m${s}\x1b[0m` : s),
  dim: (s: string) => (useColor ? `\x1b[2m${s}\x1b[0m` : s),
  red: (s: string) => (useColor ? `\x1b[31m${s}\x1b[0m` : s),
  green: (s: string) => (useColor ? `\x1b[32m${s}\x1b[0m` : s),
  yellow: (s: string) => (useColor ? `\x1b[33m${s}\x1b[0m` : s),
  cyan: (s: string) => (useColor ? `\x1b[36m${s}\x1b[0m` : s),
}

const usd = (n: number) => '$' + (n >= 100 ? n.toFixed(0) : n.toFixed(2))
const num = (n: number) => n.toLocaleString('en-US')

function days(sec: number): string {
  if (sec >= 86400) return `${Math.round(sec / 86400)}d`
  if (sec >= 3600) return `${Math.round(sec / 3600)}h`
  return `${Math.round(sec / 60)}min`
}

export function agentCount(r: FleetReport): number {
  return r.claude.projects.length + r.scheduled.filter((a) => !a.disabled).length
}

export function warningCount(r: FleetReport): number {
  return (
    r.claude.loops.length +
    r.scheduled.filter(
      (a) =>
        !a.disabled &&
        (a.zombie ||
          a.silentForSec !== null ||
          (a.lastExitCode ?? 0) !== 0 ||
          (!a.loaded && a.source === 'launchd')),
    ).length
  )
}

export function renderReport(r: FleetReport): string {
  const L: string[] = []
  const push = (s = '') => L.push(s)

  push()
  push(c.bold('🐕 leash') + c.dim(` — agent fleet report · this machine · last ${r.windowDays} days`))
  push()

  // Claude Code section
  if (!r.claude.available) {
    push(c.dim('  No Claude Code activity found (~/.claude/projects missing).'))
  } else {
    push(
      '  ' +
        c.bold(usd(r.claude.totalCostUSD)) +
        c.dim(' estimated · ') +
        c.bold(num(r.claude.totalSessions)) +
        c.dim(' sessions · ') +
        c.bold(String(r.claude.projects.length)) +
        c.dim(' Claude Code projects'),
    )
    const top = r.claude.projects.slice(0, 8)
    if (top.length) {
      push()
      const w = Math.max(...top.map((p) => p.name.length))
      for (const p of top) {
        push(
          '  ' +
            c.cyan(p.name.padEnd(w + 2)) +
            usd(p.costUSD).padStart(8) +
            c.dim(`  ${num(p.sessions)} sessions`),
        )
      }
      const rest = r.claude.projects.length - top.length
      if (rest > 0) push(c.dim(`  … and ${rest} more`))
    }
    if (r.claude.loops.length) {
      push()
      push('  ' + c.yellow(`⚠ ${r.claude.loops.length} possible loop${r.claude.loops.length > 1 ? 's' : ''} detected:`))
      for (const l of r.claude.loops.slice(0, 5)) {
        push(
          '    ' +
            c.yellow('⚠ ') +
            `${l.project} · ${l.date} · ${l.tool} repeated ${c.bold(String(l.count))}× ` +
            c.dim(`(~${usd(l.estCostUSD)})`),
        )
      }
    }
  }

  // Scheduled agents section
  push()
  const active = r.scheduled.filter((a) => !a.disabled)
  const disabled = r.scheduled.filter((a) => a.disabled)
  push(c.bold(`  Scheduled agents`) + c.dim(` (launchd + cron): ${active.length} active${disabled.length ? `, ${disabled.length} disabled` : ''}`))
  push()
  for (const a of active) {
    let icon = c.green('✓')
    let note = c.dim(a.schedule)
    if (a.zombie) {
      icon = c.red('💀')
      note = c.red(`script missing: ${a.missingPath}`)
    } else if (a.silentForSec !== null) {
      icon = c.yellow('⚠')
      note = c.yellow(`silent for ${days(a.silentForSec)} (expected ${a.schedule})`)
    } else if ((a.lastExitCode ?? 0) !== 0) {
      icon = c.yellow('⚠')
      note = c.yellow(`last exit ${a.lastExitCode} · ${a.schedule}`)
    } else if (!a.loaded && a.source === 'launchd') {
      icon = c.yellow('⚠')
      note = c.yellow(`not loaded · ${a.schedule}`)
    }
    push(`  ${icon} ${a.label}  ${note}`)
  }
  if (disabled.length) {
    for (const a of disabled) push(c.dim(`  ○ ${a.label}  disabled`))
  }

  // Footer
  push()
  const warns = warningCount(r)
  if (warns > 0) {
    push('  ' + c.yellow(`${warns} thing${warns > 1 ? 's' : ''} need${warns > 1 ? '' : 's'} your attention.`))
  } else {
    push('  ' + c.green('All quiet. ') + c.dim('Be told when that changes:'))
  }
  push(c.dim('  → npx getleash --share to post your fleet card'))
  push(c.dim('  → npx getleash connect — be alerted when a cron dies or a loop starts (waitlist)'))
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
