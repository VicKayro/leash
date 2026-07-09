# Contributing to leash

Issues and PRs welcome. The bar: keep it fast, keep it private, keep it zero-dependency.

## Setup

```
git clone https://github.com/VicKayro/leash && cd leash/cli
npm install
npm test          # esbuild + 21 tests, all offline, ~15s
node dist/index.js --days 7
```

TypeScript in `cli/src/`, bundled by esbuild into a single `dist/index.js` with a shebang. **No runtime dependencies**: if your PR adds one to `cli/package.json` `dependencies`, it will be asked to justify its existence at length.

## Layout

```
cli/src/
  index.ts          entrypoint + routing + the one-command connect prompt
  report.ts         terminal report + share card + contextual "Next:" routing
  guard.ts          budget guard (PreToolUse gate installer)
  gate-source.ts    the gate itself, written to ~/.leash/gate.mjs
  watch.ts          live monitor
  cloud.ts          connect / push / watchdog + metrics-only snapshot builder
  link.ts           platform token management
  scan/
    claude.ts       transcripts: costs (dedup by message.id+requestId), loops, nights, daily
    launchd.ts cron.ts systemd.ts
    cloud.ts        workflow/cron definitions in local repos + merge with live checks
    github.ts       GitHub Actions live health
    providers.ts    Vercel / Render / Railway / Cloudflare fetchers
cloud/
  api/              ingest (with the watchdog diff engine), fleet, alerts
  public/           landing + the dashboard (fleet.html, vanilla JS, one file)
  test/watchdog-harness.mjs   integration test: real Blob store, mock Discord
```

## Rules that are actually enforced

- **Privacy is tested**: `cloud.test.mjs` asserts the snapshot contains no home paths, no absolute paths. If your change makes it leak, CI fails.
- **Tests run offline**: `LEASH_OFFLINE=1` is set by the suite; network-dependent behavior needs a local mock server (see existing tests for the pattern).
- **Fail-open**: anything that runs inside someone's session (hooks, pushes) must never break their work when leash's own plumbing fails.
- **One next command**: the report never ends with a menu. If you add a feature, wire it into the routing in `report.ts` with a condition, not another bullet.

## Releasing (maintainers)

Bump `cli/package.json`, update `CHANGELOG.md`, sync the README (`cp README.md cli/README.md`), then `npm publish` from `cli/` and `vercel deploy --prod` from `cloud/` if it changed.
