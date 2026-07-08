import { execFileSync } from 'node:child_process'
import type { CloudAgent } from '../types'

// Live health for cloud-scheduled GitHub Actions workflows, using credentials
// that already live on this machine: GITHUB_TOKEN/GH_TOKEN, or the gh CLI's
// login. Only api.github.com is contacted, with the user's own token, to read
// the user's own workflows. Disable with LEASH_OFFLINE=1 or --offline.

const TOKEN_RE = /^(gho_|ghp_|ghs_|github_pat_)[A-Za-z0-9_]{10,}$/
const GH_CANDIDATES = ['/opt/homebrew/bin/gh', '/usr/local/bin/gh', '/usr/bin/gh', 'gh']

export function resolveGithubToken(): string | null {
  for (const env of [process.env.GITHUB_TOKEN, process.env.GH_TOKEN]) {
    if (env && TOKEN_RE.test(env.trim())) return env.trim()
  }
  // Absolute paths first: a broken `gh` npm package shadowing the real CLI on
  // PATH is a thing that happens.
  for (const bin of GH_CANDIDATES) {
    try {
      const out = execFileSync(bin, ['auth', 'token'], { encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] }).trim()
      if (TOKEN_RE.test(out)) return out
    } catch {
      continue
    }
  }
  return null
}

// Rough expected interval from a cron expression — enough to call "stale".
export function cronIntervalSec(cron: string): number | null {
  const parts = cron.trim().split(/\s+/)
  if (parts.length < 5) return null
  const [, hour, dom, mon, dow] = parts
  if (mon !== '*') return 35 * 86400
  if (dom !== '*') return 32 * 86400
  if (dow !== '*') return 8 * 86400
  if (hour === '*') return 3600
  const step = hour.match(/^\*\/(\d+)$/)
  if (step) return Math.max(1, Number(step[1])) * 3600
  if (hour.includes(',')) return Math.round(86400 / hour.split(',').length)
  return 86400
}

const agoStr = (sec: number) =>
  sec >= 86400 ? `${Math.round(sec / 86400)}d ago` : sec >= 3600 ? `${Math.round(sec / 3600)}h ago` : `${Math.max(1, Math.round(sec / 60))}m ago`

async function api(pathname: string, token: string): Promise<any> {
  const res = await fetch('https://api.github.com' + pathname, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'getleash',
    },
    signal: AbortSignal.timeout(5000),
  })
  if (!res.ok) throw new Error(`github ${res.status}`)
  return res.json()
}

async function checkRepo(slug: string, agents: CloudAgent[], token: string): Promise<void> {
  const { workflows } = await api(`/repos/${slug}/actions/workflows?per_page=100`, token)
  await Promise.all(agents.map(async (a) => {
    const wf = (workflows ?? []).find((w: any) => w.path === `.github/workflows/${a.file}`)
    if (!wf) {
      a.status = 'unknown'
      a.note = 'not found on GitHub (not pushed?)'
      return
    }
    a.url = `https://github.com/${slug}/actions/workflows/${a.file}`
    if (wf.state !== 'active') {
      a.status = 'disabled'
      a.note = String(wf.state).replace(/_/g, ' ')
      return
    }
    const { workflow_runs } = await api(`/repos/${slug}/actions/workflows/${wf.id}/runs?per_page=1&exclude_pull_requests=true`, token)
    const run = workflow_runs?.[0]
    if (!run) {
      a.status = 'unknown'
      a.note = 'enabled but never ran'
      return
    }
    const ageSec = (Date.now() - new Date(run.run_started_at || run.created_at).getTime()) / 1000
    const interval = a.schedule ? cronIntervalSec(a.schedule) : null
    if (!run.conclusion) {
      a.status = 'ok'
      a.note = 'running right now'
    } else if (run.conclusion !== 'success') {
      a.status = 'failing'
      a.note = `last run ${run.conclusion} ${agoStr(ageSec)}`
    } else if (interval && ageSec > interval * 2.5 + 6 * 3600) {
      a.status = 'stale'
      a.note = `last run ${agoStr(ageSec)} — scheduler stopped triggering it`
    } else {
      a.status = 'ok'
      a.note = `last run OK ${agoStr(ageSec)}`
    }
  }))
}

export async function enrichCloudAgents(agents: CloudAgent[]): Promise<void> {
  if (process.env.LEASH_OFFLINE) return
  const gh = agents.filter((a) => a.kind === 'github-actions' && a.slug && a.file)
  if (gh.length === 0) return
  const token = resolveGithubToken()
  if (!token) return

  const bySlug = new Map<string, CloudAgent[]>()
  for (const a of gh) {
    const list = bySlug.get(a.slug!) ?? []
    list.push(a)
    bySlug.set(a.slug!, list)
  }
  const work = Promise.all(
    [...bySlug].map(([slug, list]) =>
      checkRepo(slug, list, token).catch(() => {
        for (const a of list) if (!a.status) a.status = 'unknown'
      }),
    ),
  )
  // Never let a slow API hold the report hostage. unref: the guard timer must
  // not keep the process alive after the work finishes.
  await Promise.race([work, new Promise((r) => setTimeout(r, 10_000).unref())])
}
