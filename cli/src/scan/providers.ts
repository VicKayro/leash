import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import type { CloudAgent } from '../types'
import { resolveGithubToken, cronIntervalSec } from './github'

// Cloud platforms where agents actually run. Tokens come from, in order:
// env var → getleash link → a CLI already logged in on this machine.
// All calls are read-only, direct to the provider, never through leash servers.

const LEASH_DIR = () => process.env.LEASH_DIR || path.join(os.homedir(), '.leash')
const STORE = () => path.join(LEASH_DIR(), 'providers.json')

export type ProviderId = 'github' | 'vercel' | 'render' | 'railway' | 'cloudflare'

export interface ProviderMeta {
  id: ProviderId
  label: string
  envVar: string
  tokenUrl: string // where a human creates a token
}

export const PROVIDERS: ProviderMeta[] = [
  { id: 'github', label: 'GitHub Actions', envVar: 'GITHUB_TOKEN', tokenUrl: 'github.com/settings/tokens (or: gh auth login)' },
  { id: 'vercel', label: 'Vercel', envVar: 'VERCEL_TOKEN', tokenUrl: 'vercel.com/account/settings/tokens (or: vercel login)' },
  { id: 'render', label: 'Render', envVar: 'RENDER_API_KEY', tokenUrl: 'dashboard.render.com/settings#api-keys' },
  { id: 'railway', label: 'Railway', envVar: 'RAILWAY_TOKEN', tokenUrl: 'railway.com/account/tokens' },
  { id: 'cloudflare', label: 'Cloudflare Workers', envVar: 'CLOUDFLARE_API_TOKEN', tokenUrl: 'dash.cloudflare.com/profile/api-tokens' },
]

function readStore(): Record<string, { token: string }> {
  try {
    return JSON.parse(fs.readFileSync(STORE(), 'utf8'))
  } catch {
    return {}
  }
}

export function saveProviderToken(id: ProviderId, token: string): void {
  const store = readStore()
  store[id] = { token }
  fs.mkdirSync(LEASH_DIR(), { recursive: true })
  fs.writeFileSync(STORE(), JSON.stringify(store, null, 2) + '\n', { mode: 0o600 })
  try {
    fs.chmodSync(STORE(), 0o600)
  } catch {}
}

export function removeProviderToken(id: ProviderId): void {
  const store = readStore()
  delete store[id]
  fs.writeFileSync(STORE(), JSON.stringify(store, null, 2) + '\n', { mode: 0o600 })
}

function vercelCliToken(): string | null {
  const candidates = [
    process.env.XDG_DATA_HOME && path.join(process.env.XDG_DATA_HOME, 'com.vercel.cli', 'auth.json'),
    path.join(os.homedir(), 'Library', 'Application Support', 'com.vercel.cli', 'auth.json'),
    path.join(os.homedir(), '.local', 'share', 'com.vercel.cli', 'auth.json'),
    path.join(os.homedir(), '.vercel', 'auth.json'),
  ].filter(Boolean) as string[]
  for (const p of candidates) {
    try {
      const t = JSON.parse(fs.readFileSync(p, 'utf8')).token
      if (typeof t === 'string' && t.length > 10) return t
    } catch {}
  }
  return null
}

// token + where it came from, for the `link` status display
export function resolveProvider(id: ProviderId): { token: string; source: string } | null {
  const meta = PROVIDERS.find((p) => p.id === id)!
  const env = process.env[meta.envVar]
  if (env && env.trim().length > 10) return { token: env.trim(), source: `$${meta.envVar}` }
  const stored = readStore()[id]?.token
  if (stored) return { token: stored, source: 'linked (getleash link)' }
  if (id === 'github') {
    const t = resolveGithubToken()
    if (t) return { token: t, source: 'gh CLI login' }
  }
  if (id === 'vercel') {
    const t = vercelCliToken()
    if (t) return { token: t, source: 'vercel CLI login' }
  }
  return null
}

const j = async (url: string, headers: Record<string, string>): Promise<any> => {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(5000) })
  if (!res.ok) throw new Error(`${res.status}`)
  return res.json()
}

const agoStr = (ms: number) => {
  const sec = (Date.now() - ms) / 1000
  return sec >= 86400 ? `${Math.round(sec / 86400)}d ago` : sec >= 3600 ? `${Math.round(sec / 3600)}h ago` : `${Math.max(1, Math.round(sec / 60))}m ago`
}

// ── Vercel: crons on projects, across personal + team scopes ─────────
async function vercelAgents(token: string): Promise<CloudAgent[]> {
  const h = { Authorization: `Bearer ${token}` }
  const scopes: Array<{ teamId: string | null; slug: string }> = [{ teamId: null, slug: '' }]
  try {
    const { teams } = await j('https://api.vercel.com/v2/teams', h)
    for (const t of teams ?? []) scopes.push({ teamId: t.id, slug: t.slug })
  } catch {}
  const agents: CloudAgent[] = []
  await Promise.all(scopes.map(async (scope) => {
    try {
      const q = scope.teamId ? `?teamId=${scope.teamId}&limit=100` : '?limit=100'
      const { projects } = await j(`https://api.vercel.com/v9/projects${q}`, h)
      for (const p of projects ?? []) {
        const defs = p?.crons?.definitions ?? []
        if (!defs.length) continue
        const disabled = !!p.crons.disabledAt
        const latest = (p.latestDeployments ?? [])[0]?.readyState
        for (const d of defs.slice(0, 20)) {
          agents.push({
            repo: p.name,
            kind: 'vercel-cron',
            name: d.path ?? 'cron',
            schedule: d.schedule ?? null,
            status: disabled ? 'disabled' : latest === 'ERROR' ? 'failing' : 'ok',
            note: disabled
              ? 'crons disabled on Vercel'
              : latest === 'ERROR'
                ? 'latest production deployment failed'
                : 'enabled on Vercel',
            url: scope.slug ? `https://vercel.com/${scope.slug}/${p.name}/settings/cron-jobs` : null,
          })
        }
      }
    } catch {}
  }))
  return agents
}

// ── Render: cron job services ────────────────────────────────────────
async function renderAgents(token: string): Promise<CloudAgent[]> {
  const items = await j('https://api.render.com/v1/services?limit=100', {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
  })
  const agents: CloudAgent[] = []
  for (const item of Array.isArray(items) ? items : []) {
    const s = item?.service ?? item
    if (!s || s.type !== 'cron_job') continue
    const schedule = s.serviceDetails?.schedule ?? null
    const lastOk = s.serviceDetails?.lastSuccessfulRunAt
    const suspended = s.suspended === 'suspended'
    let status: CloudAgent['status'] = suspended ? 'disabled' : 'ok'
    let note = suspended ? 'suspended on Render' : lastOk ? `last successful run ${agoStr(new Date(lastOk).getTime())}` : 'enabled on Render'
    if (!suspended && lastOk && schedule) {
      const interval = cronIntervalSec(schedule)
      if (interval && Date.now() - new Date(lastOk).getTime() > (interval * 2.5 + 6 * 3600) * 1000) {
        status = 'stale'
        note = `no successful run since ${agoStr(new Date(lastOk).getTime())}`
      }
    }
    agents.push({
      repo: 'render',
      kind: 'render-cron',
      name: s.name,
      schedule,
      status,
      note,
      url: s.id ? `https://dashboard.render.com/cron/${s.id}` : null,
    })
  }
  return agents
}

// ── Cloudflare: workers with cron triggers ───────────────────────────
async function cloudflareAgents(token: string): Promise<CloudAgent[]> {
  const h = { Authorization: `Bearer ${token}` }
  const accounts = (await j('https://api.cloudflare.com/client/v4/accounts', h))?.result ?? []
  const agents: CloudAgent[] = []
  for (const acc of accounts.slice(0, 3)) {
    let scripts: any[] = []
    try {
      scripts = (await j(`https://api.cloudflare.com/client/v4/accounts/${acc.id}/workers/scripts`, h))?.result ?? []
    } catch {
      continue
    }
    await Promise.all(
      scripts.slice(0, 30).map(async (s: any) => {
        try {
          const schedules =
            (await j(`https://api.cloudflare.com/client/v4/accounts/${acc.id}/workers/scripts/${s.id}/schedules`, h))?.result
              ?.schedules ?? []
          for (const sch of schedules.slice(0, 10)) {
            agents.push({
              repo: acc.name ?? 'cloudflare',
              kind: 'cloudflare-worker',
              name: s.id,
              schedule: sch.cron ?? null,
              status: 'ok',
              note: 'deployed with a cron trigger',
              url: `https://dash.cloudflare.com/${acc.id}/workers/services/view/${s.id}`,
            })
          }
        } catch {}
      }),
    )
  }
  return agents
}

// ── Railway: services with a cron schedule ───────────────────────────
async function railwayAgents(token: string): Promise<CloudAgent[]> {
  const query = `query {
    me { projects { edges { node { name services { edges { node {
      name
      serviceInstances { edges { node { cronSchedule latestDeployment { status } } } }
    } } } } } } }
  }`
  const res = await fetch('https://backboard.railway.app/graphql/v2', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
    signal: AbortSignal.timeout(5000),
  })
  if (!res.ok) throw new Error(`${res.status}`)
  const data = (await res.json())?.data?.me?.projects?.edges ?? []
  const agents: CloudAgent[] = []
  for (const pe of data) {
    for (const se of pe?.node?.services?.edges ?? []) {
      for (const ie of se?.node?.serviceInstances?.edges ?? []) {
        const inst = ie?.node
        if (!inst?.cronSchedule) continue
        const st = inst.latestDeployment?.status
        agents.push({
          repo: pe.node.name,
          kind: 'railway',
          name: se.node.name,
          schedule: inst.cronSchedule,
          status: st === 'FAILED' || st === 'CRASHED' ? 'failing' : 'ok',
          note: st ? `latest deployment ${String(st).toLowerCase()}` : 'scheduled on Railway',
          url: null,
        })
      }
    }
  }
  return agents
}

const FETCHERS: Partial<Record<ProviderId, (token: string) => Promise<CloudAgent[]>>> = {
  vercel: vercelAgents,
  render: renderAgents,
  cloudflare: cloudflareAgents,
  railway: railwayAgents,
}

// Live agents from every connected platform (GitHub is handled separately,
// by enriching workflows found in local repos).
export async function providerAgents(): Promise<{ agents: CloudAgent[]; active: ProviderId[] }> {
  if (process.env.LEASH_OFFLINE) return { agents: [], active: [] }
  const active: ProviderId[] = []
  const jobs: Array<Promise<CloudAgent[]>> = []
  for (const id of Object.keys(FETCHERS) as ProviderId[]) {
    const cred = resolveProvider(id)
    if (!cred) continue
    active.push(id)
    jobs.push(FETCHERS[id]!(cred.token).catch(() => []))
  }
  if (!jobs.length) return { agents: [], active }
  const results = await Promise.race([
    Promise.all(jobs),
    new Promise<CloudAgent[][]>((r) => setTimeout(() => r([]), 8_000).unref()),
  ])
  return { agents: (results ?? []).flat(), active }
}

// Cheapest possible call to check a token actually works.
export async function validateProvider(id: ProviderId, token: string): Promise<boolean> {
  try {
    if (id === 'github') return !!(await j('https://api.github.com/user', { Authorization: `Bearer ${token}`, 'User-Agent': 'getleash' }))
    if (id === 'vercel') return !!(await j('https://api.vercel.com/v2/user', { Authorization: `Bearer ${token}` }))
    if (id === 'render') return !!(await j('https://api.render.com/v1/services?limit=1', { Authorization: `Bearer ${token}` }))
    if (id === 'cloudflare') return !!(await j('https://api.cloudflare.com/client/v4/user/tokens/verify', { Authorization: `Bearer ${token}` }))
    if (id === 'railway') {
      const res = await fetch('https://backboard.railway.app/graphql/v2', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: 'query { me { id } }' }),
        signal: AbortSignal.timeout(5000),
      })
      return res.ok && !!(await res.json())?.data?.me?.id
    }
  } catch {
    return false
  }
  return false
}
