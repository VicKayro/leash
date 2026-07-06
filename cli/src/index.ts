import { scanClaude } from './scan/claude'
import { scanLaunchd } from './scan/launchd'
import { scanCron } from './scan/cron'
import { renderReport, renderShareCard } from './report'
import type { FleetReport } from './types'

const HELP = `
leash — see what your agents did last night. No signup, nothing leaves this machine.

Usage:
  npx getleash            fleet report (Claude Code + launchd + cron)
  npx getleash --share    shareable fleet card
  npx getleash --json     machine-readable output
  npx getleash --days N   window in days (default 30)
`

async function main() {
  const args = process.argv.slice(2)
  if (args.includes('--help') || args.includes('-h')) {
    console.log(HELP)
    return
  }
  if (args.includes('--version') || args.includes('-v')) {
    console.log(require('../package.json').version)
    return
  }
  const daysIdx = args.indexOf('--days')
  const windowDays = daysIdx >= 0 ? Math.max(1, Number(args[daysIdx + 1]) || 30) : 30

  const [claude, launchd, cron] = await Promise.all([
    scanClaude(windowDays),
    Promise.resolve().then(scanLaunchd),
    Promise.resolve().then(scanCron),
  ])

  const report: FleetReport = {
    generatedAt: new Date().toISOString(),
    windowDays,
    claude,
    scheduled: [...launchd, ...cron],
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
