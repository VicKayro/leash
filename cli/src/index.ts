import { scanClaude } from './scan/claude'
import { scanLaunchd } from './scan/launchd'
import { scanCron } from './scan/cron'
import { scanSystemd } from './scan/systemd'
import { collectCloud } from './scan/cloud'
import { linkCommand } from './link'
import { renderReport, renderShareCard } from './report'
import { guardCommand } from './guard'
import { watchCommand } from './watch'
import { connectCommand, pushCommand, pushReport, readCloudConfig, watchdogCommand } from './cloud'
import type { FleetReport } from './types'

const HELP = `
leash — see what your agents did last night. No signup. Local by default; nothing leaves this machine unless you \`connect\`.

Usage:
  npx getleash            fleet report (Claude Code + launchd + cron)
  npx getleash watch      LIVE monitor — top for your agents (cost ticking, burn rate)
  npx getleash --share    shareable fleet card
  npx getleash --json     machine-readable output
  npx getleash --days N   window in days (default 30)

Cloud platforms (GitHub Actions, Vercel, Render, Railway, Cloudflare):
  npx getleash link       see which platforms are connected + how to add one
  npx getleash link render <token>       health-check your Render agents too
  (GitHub and Vercel auto-connect through your local gh / vercel logins.
   Read-only, tokens go only to their own platform. Skip all: --offline)

leash cloud (free — fleet dashboard across machines):
  npx getleash connect    get your private fleet URL, auto-push on session end
  npx getleash push       push a fresh snapshot now
  npx getleash connect --fleet <token>   add this machine to an existing fleet
  npx getleash connect --off             disconnect

🐕 Watchdog (free, like everything else):
  npx getleash watchdog --discord <webhook-url>   bark on Discord the moment
                                                  an agent dies, loops or fails
  npx getleash watchdog            status · --off  disarm

Budget guard (hard spend caps for Claude Code — it has no native ones):
  npx getleash guard --daily 25    block tool calls past $25/day
  npx getleash guard --hourly 5    burn-rate cap — kills runaway loops fast
  npx getleash guard --status      caps + current spend
  npx getleash guard --off         remove the guard
`

async function main() {
  const args = process.argv.slice(2)
  if (args.includes('--help') || args.includes('-h')) {
    console.log(HELP)
    return
  }
  if (args[0] === 'connect') {
    await connectCommand(args.slice(1))
    return
  }
  if (args[0] === 'push') {
    await pushCommand(args.slice(1))
    return
  }
  if (args[0] === 'link') {
    await linkCommand(args.slice(1))
    return
  }
  if (args[0] === 'watchdog') {
    await watchdogCommand(args.slice(1))
    return
  }
  if (args[0] === 'guard') {
    guardCommand(args.slice(1))
    return
  }
  if (args[0] === 'watch') {
    await watchCommand(args.slice(1))
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
  if (args.includes('--offline')) process.env.LEASH_OFFLINE = '1'
  const cloud = await collectCloud(claude.projects.map((p) => p.cwd))

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

  // Connected machines refresh their dashboard on every run. Silent, fail-open.
  const cloudConfig = readCloudConfig()
  if (cloudConfig) {
    await pushReport(report, cloudConfig).catch(() => {})
    return
  }

  // One command, not four: offer the dashboard right here. A keypress is the
  // consent line — data only leaves the machine if the user says so.
  const interactive =
    process.stdin.isTTY && process.stdout.isTTY &&
    !args.includes('--json') && !args.includes('--share') && !args.includes('--no-cloud')
  if (interactive) {
    const readline = await import('node:readline')
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    const answer = await new Promise<string>((resolve) => {
      rl.question(
        '  ↵ Enter to put this on a free live dashboard (no signup, metrics only, off anytime) · n to skip: ',
        resolve,
      )
      rl.on('close', () => resolve('n'))
    })
    rl.close()
    if (answer.trim() === '' || /^y/i.test(answer.trim())) {
      await connectCommand([], report) // reuse the scan we just did
    }
  }
}

main().catch((err) => {
  console.error('leash: unexpected error —', err?.message ?? err)
  process.exit(1)
})
