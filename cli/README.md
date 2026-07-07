# 🐕 leash

**See what your agents did last night.** One command shows you every AI agent and scheduled job on your machine: what they cost, which ones are dead, which ones went crazy. In 10 seconds, no signup, nothing leaves your computer.

```
npx getleash
```

```
🐕 leash · your agent fleet on this machine · last 30 days

  The short version
  Your agents did $1,599 worth of AI work across 82 sessions.
  (That's the pay-as-you-go API value. On a subscription like Claude
  Pro/Max you paid a flat fee — this is what your usage is worth.)
  9 agents live here: 8 look fine, 1 needs you (fixes below).

  Your scheduled agents · 7 active · 6 turned off on purpose
  ✓ com.kayro.demand-radar          every 30min
  ⚠ com.victorgalli.daily-watch     last run failed
  💀 com.old.autopilot               zombie — script is gone

  To fix (1) — copy-paste the command under each one

  1. com.victorgalli.daily-watch failed its last run
     It's still scheduled (monthly) but the last run crashed (exit code 1). See why:
     tail -20 "~/Library/Logs/daily-watch.err.log"
```

Every warning comes with the exact command to fix it. Copy, paste, done.

## Who is this for?

Anyone who has automated things with AI and lost track of them:

- You use **Claude Code** and wonder where the money goes
- You have **cron jobs or scheduled scripts** (agents, backups, reports) and no idea if they still run
- You once found out an automation had been **silently broken for weeks**

True story: the first ever run of leash was on its creator's machine. It found 3 daily automations that had **never run once** (a morning briefing, a backup, an alerting system) and one script crashed since July 1st. All fixed in 5 minutes with the commands leash printed.

## Never used a terminal? Start here

1. **Open the Terminal app.** On a Mac: press `⌘ + space`, type `terminal`, press Enter. A window with text appears — that's it.
2. **Paste this and press Enter:**
   ```
   npx getleash
   ```
3. **If it says `command not found: npx`**: you need Node.js first (free, 2 minutes). Go to [nodejs.org](https://nodejs.org), click the big green button, install, close and reopen Terminal, try again.

That's all. No account, no configuration, and the scan only *reads* — it changes nothing on your machine.

## How to read your report

| Symbol | Meaning |
|---|---|
| ✓ | This agent looks healthy |
| ⚠ | Something's wrong (not running, crashed, or suspiciously silent) — see the "things to fix" list below it |
| 💀 | Zombie: scheduled job pointing to a script that no longer exists |
| ○ | Disabled on purpose, nothing to do |

The dollar amount is what your Claude Code usage would cost at API prices over the last 30 days (estimated: per-model rates, cache-aware, deduplicated the same way as ccusage). If you're on a subscription plan, it's what your usage is *worth*, not what you paid.

## What it scans

- **Claude Code activity** (`~/.claude/projects`): estimated spend per project, sessions, and **loop detection** — the same tool call repeated 10+ times with identical input is almost never intentional, and it burns real money.
- **Scheduled jobs** (`~/Library/LaunchAgents` + `crontab`): schedule, loaded state, last exit code, zombies, silent jobs (log untouched for 2x the expected interval). Vendor updaters (Google, Adobe...) are filtered out.

## Commands

```
npx getleash            fleet report
npx getleash --share    shareable fleet card (post your damage)
npx getleash --json     machine-readable output
npx getleash --days N   window in days (default 30)
npx getleash connect    leash cloud waitlist
```

## Privacy

The scan is 100% local. No network calls, no telemetry, no account. Your prompts, your costs, your mess: none of it leaves your machine.

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
