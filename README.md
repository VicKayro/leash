# 🐕 leash

**See what your agents did last night — and cap what they can spend.** One command shows you every AI agent and scheduled job on your machine: what they cost, which ones are dead, which ones went crazy. Another gives Claude Code the hard daily spend limit it doesn't have. 10 seconds, no signup, nothing leaves your computer.

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
- **Scheduled jobs**: launchd on macOS, systemd user timers on Linux (beta), crontab everywhere — schedule, loaded state, last exit code, zombies, silent jobs (log untouched for 2x the expected interval). Vendor updaters (Google, Adobe...) are filtered out.
- **Cloud-scheduled agents defined in your local repos** (GitHub Actions `schedule:` workflows, `vercel.json` crons): listed so your fleet count is honest — leash can't tell from your machine whether those are alive. That's what the cloud version is for.

## `getleash watch` — top, for your agents

A live monitor in your terminal: every Claude Code session currently running on your machine, its cost ticking in real time, the tool it's executing right now, and its burn rate per hour.

```
🐕 leash watch · live agent monitor · guard: $25/day · Ctrl+C to quit

  LIVE · 2 sessions  burning $41.20/hour right now
  ● myapp/backend · 0b8a68c4    $12.91  ↑$39.73/h   Edit: server.ts      4s ago
  ● ~ (home) · f3417001          $1.41  ↑$1.50/h    Bash: npm test       12s ago
```

Watch your agents work. Catch a loop the moment it starts spinning, not on next month's bill.

## The budget guard: a hard daily spend cap for Claude Code

Claude Code has **no native spend limit**. One runaway loop can burn $100 in tokens before you notice. leash gives you a real one, in one command:

```
npx getleash guard --daily 25 --hourly 5
```

The two caps do different jobs: `--daily` is your overall budget, `--hourly` is the **loop killer** — a runaway loop burning $10 in 8 minutes sails under a daily cap but slams into a burn-rate cap within minutes.

That installs a tiny local [PreToolUse hook](https://docs.anthropic.com/en/docs/claude-code/hooks) that checks your estimated spend today (from your local transcripts, cached 2 minutes) and **blocks tool calls** past the cap, with a clear message telling you how to raise or disable it. Notes:

- 100% local, like everything else — no account, no server.
- **Fail-open by design**: if anything at all goes wrong (broken config, missing files), Claude Code works normally. The guard can only ever block when it positively knows you're over budget.
- `getleash guard --status` shows the cap and today's spend. `getleash guard --off` removes it cleanly (your original `settings.json` is backed up as `settings.json.pre-leash` the first time).
- Heads-up: the cap applies to everything on this machine, including the session you're currently in. Start with a comfortable number.

## Commands

```
npx getleash                  fleet report
npx getleash watch            live monitor (top for agents)
npx getleash --share          shareable fleet card (post your damage)
npx getleash --json           machine-readable output
npx getleash --days N         window in days (default 30)
npx getleash guard --daily N --hourly M  hard spend caps (see above)
npx getleash guard --status   cap + today's spend
npx getleash guard --off      remove the guard
npx getleash link             connect the platforms where your agents run
npx getleash connect          free fleet dashboard in the cloud (see below)
npx getleash push             refresh your cloud dashboard now
npx getleash connect --off    disconnect from the cloud
```

## Your agents don't just live on your laptop

Agents also run on GitHub Actions, Vercel, Render, Railway, Cloudflare Workers — and those die silently too. leash checks them **live**, with credentials that are already on your machine:

- **GitHub Actions** — auto-detected via your `gh` login (or `GITHUB_TOKEN`): last run status, disabled workflows, schedules that silently stopped firing
- **Vercel** — auto-detected via your `vercel` login (or `VERCEL_TOKEN`): every cron across all your projects, enabled/disabled, failed deployments
- **Render / Railway / Cloudflare Workers** — paste a read-only token once:

```
npx getleash link                      # see what's connected
npx getleash link render <api-key>     # ~10 seconds per platform
```

Tokens are stored in `~/.leash/providers.json` (chmod 600), sent **only to their own platform's API**, read-only, never to leash. Skip all remote checks with `--offline`.

## leash cloud — your fleet on one page (free beta)

The scan is a snapshot of one machine. The fear is continuous, and fleets span laptops, servers, VMs:

```
npx -y getleash connect
```

No signup, no email. You get a private URL like `getleash.vercel.app/f/flt_…` showing every connected machine: spend, sessions, dead crons, loops, guard status. A `SessionEnd` hook refreshes it after each Claude Code session, and every `npx getleash` run pushes fresh data too.

- Add another machine to the same fleet: `npx -y getleash connect --fleet <your-token>`
- The URL is a capability: anyone who has it can view your fleet metrics. Keep it private.
- Coming next: email/Discord alerts when a cron dies or a loop starts, budget guard synced across machines. **[Waitlist for alerts →](https://github.com/VicKayro/leash/issues/1)** — a 👍 is enough.

## Privacy

The local scan makes no network calls, no telemetry, no account. `connect` is opt-in and uploads **metrics only** — costs, counts, agent names and health. Never prompts, transcripts, file paths or file contents. `connect --off` removes the hook and the token.

## Dev

```
cd cli && npm install && npm run build && node dist/index.js
```

Note: the npm package is `getleash` (the name `leash` is squatted by an abandoned 2022 package — dispute pending). Both `leash` and `getleash` bins are installed.

MIT
