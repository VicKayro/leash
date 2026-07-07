import { scanClaude } from './scan/claude'
import { scanLaunchd } from './scan/launchd'
import { scanCron } from './scan/cron'
import { scanSystemd } from './scan/systemd'
import { scanCloud } from './scan/cloud'
import { renderReport, renderShareCard } from './report'
import { guardCommand } from './guard'
import type { FleetReport } from './types'

const HELP = `
leash — see what your agents did last night. No signup, nothing leaves this machine.

Usage:
  npx getleash            fleet report (Claude Code + launchd + cron)
  npx getleash --share    shareable fleet card
  npx getleash --json     machine-readable output
  npx getleash --days N   window in days (default 30)
  npx getleash connect    leash cloud waitlist (alerts, kill switch, replay)

Budget guard (hard daily spend cap for Claude Code — it has no native one):
  npx getleash guard --daily 25    block tool calls past $25/day
  npx getleash guard --status      cap + today's spend
  npx getleash guard --off         remove the guard
`

const CONNECT = `
leash cloud — the scan is a snapshot. The fear is continuous.

Coming: email/Discord alert when a cron dies or a loop starts,
hard budgets with a kill switch, session replay across machines.

Join the waitlist (30 seconds, just a 👍):
  https://github.com/VicKayro/leash/issues/1
`

async function main() {
  const args = process.argv.slice(2)
  if (args.includes('--help') || args.includes('-h')) {
    console.log(HELP)
    return
  }
  if (args.includes('connect')) {
    console.log(CONNECT)
    return
  }
  if (args[0] === 'guard') {
    guardCommand(args.slice(1))
    return
  }
  if (args.includes('--version') || args.includes('-v')) {
    console.log(require('../package.json').version)
    return
  }
  const daysIdx = args.indexOf('--days')
  const windowDays = daysIdx >= 0 ? Math.max(1, Number(args[daysIdx + 1]) || 30) : 30

  const [claude, launchd, cron, systemd] = await Promise.all([
    scanClaude(windowDays),
    Promise.resolve().then(scanLaunchd),
    Promise.resolve().then(scanCron),
    Promise.resolve().then(scanSystemd),
  ])
  const cloud = scanCloud(claude.projects.map((p) => p.cwd))

  const report: FleetReport = {
    generatedAt: new Date().toISOString(),
    windowDays,
    claude,
    scheduled: [...launchd, ...systemd, ...cron],
    cloud,
  }

  if (args.includes('--json')) {
    console.log(JSON.stringify(report, null, 2))
  } else if (args.includes('--share')) {
    console.log(renderShareCard(report))
  } else {
    console.log(renderReport(report))
  }
}

main().catch((err) => {
  console.error('leash: unexpected error —', err?.message ?? err)
  process.exit(1)
})
