# Changelog

All notable changes to leash. Dates are 2026. The pace is the point.

## 0.12.0 — July 9

**🐕 Watchdog: the one paid thing (free during the beta).**

- Cloud alert engine: every push is diffed against the machine's previous one; **new** problems (zombie crons, failing workflows, runaway loops) bark in your Discord channel with a dashboard link. Known problems stay quiet.
- `getleash watchdog --discord <webhook-url>` arms it (proves the webhook with a test ping first), `watchdog` shows status, `--off` disarms.
- Dashboard: "🐕 watchdog armed" badge, arm CTA under Needs attention.
- Pricing made explicit everywhere: everything visible free forever, Watchdog free in beta then $15/mo, opt-in only.
- 21 CLI tests + a 7-check integration harness for the alert engine (real Blob store, mock Discord).

## 0.11.0 — July 9

**One command.** `npx getleash` now does everything: scan, live platform checks, and (on a TTY, when not connected) a single **Enter** puts the fleet on the free live dashboard, reusing the scan it just did. No auto-upload, ever: the keypress is the consent line. `--no-cloud` skips the prompt.

## 0.10.0 — July 9

**🌙 Night replay.** The dashboard gains "While you slept": one midnight-to-7am track per night, each session block placed at the hour it actually ran, with cost and tool calls on hover. Resumed sessions span days, so the scan now records true per-night activity bounds and splits session cost pro-rata.

## 0.9.0 — July 8

**Dashboard v2, story-first.** Animated hero ("Your agents did $1,746 of AI work"), live-agents pulse chip, ROI vs subscription, 30-day cost pulse chart, the fleet as health dots (problems first), severity-bordered attention list, "month in agents" facts. New in the snapshot: per-day costs, top session, ROI, last activity. Still metrics-only, still no paths.

## 0.8.0 — July 8

**Live health checks for cloud platforms.**

- `getleash link`: GitHub and Vercel auto-detect from the `gh` / `vercel` logins already on your machine; Render, Railway and Cloudflare take a read-only token, validated before saving, stored chmod 600, sent only to their own platform.
- GitHub Actions: last-run status, disabled workflows, schedules that silently stopped firing (inferred from the cron expression).
- Vercel: every cron across all projects and teams with real state, replacing static `vercel.json` guesses.
- Failing cloud agents join the fix list and the dashboard's Needs attention. `--offline` skips every remote check. Report wall-time ~2.5s.

## 0.7.0 — July 8

**leash cloud, free beta.** `connect` generates a fleet token (a private capability URL, no signup), pushes a metrics-only snapshot and installs a `SessionEnd` hook so the dashboard refreshes after each Claude Code session. `push`, `connect --fleet`, `connect --off`. An e2e test asserts the snapshot contains no paths and no content. Backend: Vercel functions + Blob, ~200 lines.

## 0.6.x — July 7-8

- **0.6.1**: contextual product routing: the report ends with ONE next command computed from your data (personalized guard caps, watch if a session is live), never a menu.
- **0.6.0**: **`getleash watch`**: `top` for your agents. Live sessions, cost ticking, current tool call, burn rate $/h. Incremental JSONL tailing, message-timestamp burn windows.

## 0.5.0 — July 7

**"Your month in agents."** Night sessions, active days, tool-call totals, biggest session, and the ROI multiple vs your subscription ("≈ 8.2× a $200/mo Max"). The share card now counts cloud agents and sessions that ran while you slept.

## 0.4.0 — July 7

**Hourly burn-rate cap**: `guard --hourly 5` kills a runaway loop in ~2 minutes, long before a daily cap would notice. Caps merge instead of overwriting each other.

## 0.3.0 — July 7

**The budget guard.** `getleash guard --daily 25`: a `PreToolUse` hook that estimates spend from local transcripts and **blocks** tool calls past the cap. Claude Code has no native spend limit; now it has one. Fail-open, 120s cache, settings backed up, `--off` restores everything.

## 0.2.0 — July 7

Linux support (systemd), cloud-scheduled agent discovery in local repos (GitHub Actions `schedule:`, `vercel.json` crons), shell-escaped fix-it commands, first test suite.

## 0.1.1 — July 7

First public release. Local scan: Claude Code costs per project (deduplicated like `ccusage`), loop detection, launchd/cron health (zombies, silent jobs, failed runs), terminal report with copy-paste fixes, `--share` card, `--json`. Zero runtime dependencies, ~0.6s.
