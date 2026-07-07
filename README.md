# 🐕 leash

**See what your agents did last night.** Fleet report for Claude Code + scheduled agents (launchd, cron) — costs, loops, dead crons, zombies. In 10 seconds, no signup, nothing leaves your machine.

```
npx getleash
```

```
🐕 leash — agent fleet report · this machine · last 30 days

  $1581 estimated · 82 sessions · 2 Claude Code projects

  ⚠ com.victorgalli.ceo-briefing      not loaded · daily at 07:15
  ⚠ com.victorgalli.discord-watch     last exit 1 · monthly
  💀 com.old.autopilot                 script missing (zombie)

  4 things need your attention.
```

## What it scans

- **Claude Code activity** (`~/.claude/projects`): estimated spend per project (per-model rates, cache-tier aware, deduped like ccusage), sessions, and **loop detection** — the same tool call repeated 10+ times with identical input is almost never intentional.
- **launchd agents** (`~/Library/LaunchAgents`): schedule, loaded state, last exit code, zombies (plist pointing to a deleted script), silent jobs (log untouched for 2x the expected interval). Vendor updaters (Google, Adobe...) are filtered out.
- **crontab**: schedule, missing script targets.

## Flags

```
npx getleash            fleet report
npx getleash --share    shareable fleet card
npx getleash --json     machine-readable output
npx getleash --days N   window in days (default 30)
npx getleash connect    leash cloud waitlist
```

## Privacy

The scan is 100% local. No network calls, no telemetry, no account. `--json` output is yours to do whatever you want with.

## Coming next — leash cloud

The scan is a snapshot. The fear is continuous: *what about the next time an agent loops at 3am?*

**leash cloud** (in the works): connect your machines, get an email/Discord ping when a cron dies or a loop starts, hard budgets with a kill switch (a Claude Code `PreToolUse` hook that actually blocks the call — yes, that works, and no, Claude Code has no native spend limit), session replay across machines.

**[→ Join the waitlist](https://github.com/VicKayro/leash/issues/1)** — a 👍 is enough. The CLI stays free and open source.

## Dev

```
cd cli && npm install && npm run build && node dist/index.js
```

Note: the npm package is `getleash` (the name `leash` is squatted by an abandoned 2022 package — dispute pending). Both `leash` and `getleash` bins are installed.

MIT
