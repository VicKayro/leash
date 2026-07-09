# Security policy

leash's promise is stronger than most: the local scan makes zero network calls, the cloud is opt-in and metrics-only, platform tokens never transit through leash servers. A hole in any of those claims is a critical bug.

## Reporting

Email **victor@kayro.ai** with the details (proof of concept appreciated). You'll get a reply within 48 hours. Please don't open a public issue for anything exploitable.

## Scope

- The snapshot leaking prompts, transcript content, file paths or file contents
- Platform tokens (`~/.leash/providers.json`) being read, exfiltrated or sent anywhere other than their own platform's API
- Fleet-token capability URLs being guessable or enumerable
- The budget guard being bypassable from inside a session (the `PreToolUse` gate)
- The watchdog webhook being readable through the public API

## Non-scope

- Someone you gave your dashboard URL to reading your dashboard (that's the capability model; rotate with `connect --off` + `connect`)
- Vulnerabilities in Claude Code, Discord, or the platforms leash reads from
