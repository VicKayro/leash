import * as fs from 'node:fs'
import * as path from 'node:path'
import type { CloudAgent } from '../types'

// Agents scheduled in the cloud (GitHub Actions cron, Vercel crons) are
// invisible to a local scan — but their *definitions* live in local repos.
// We surface them so the fleet count is honest about what leash can't see.

const MAX_DIRS = 200

function gitChildren(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
      .map((e) => path.join(dir, e.name))
      .filter((p) => fs.existsSync(path.join(p, '.git')))
  } catch {
    return []
  }
}

function candidateRepos(cwds: string[]): string[] {
  const set = new Set<string>()
  for (const cwd of cwds) {
    if (!cwd) continue
    if (fs.existsSync(path.join(cwd, '.git'))) set.add(cwd)
    for (const c of gitChildren(cwd)) set.add(c)
    for (const c of gitChildren(path.dirname(cwd))) set.add(c)
    if (set.size >= MAX_DIRS) break
  }
  return [...set].slice(0, MAX_DIRS)
}

// owner/repo from the git remote, so live health checks know what to ask GitHub.
export function repoSlug(repoDir: string): string | null {
  try {
    const cfg = fs.readFileSync(path.join(repoDir, '.git', 'config'), 'utf8')
    const m = cfg.match(
      /url\s*=\s*(?:git@github\.com:|https:\/\/github\.com\/|ssh:\/\/git@github\.com\/)([^/\s]+\/[^/\s]+?)(?:\.git)?\s*$/m,
    )
    return m ? m[1] : null
  } catch {
    return null
  }
}

function scanRepo(repo: string): CloudAgent[] {
  const found: CloudAgent[] = []
  const repoName = path.basename(repo)

  const wfDir = path.join(repo, '.github', 'workflows')
  if (fs.existsSync(wfDir)) {
    let files: string[] = []
    try {
      files = fs.readdirSync(wfDir).filter((f) => /\.ya?ml$/.test(f)).slice(0, 20)
    } catch {
      files = []
    }
    const slug = files.length ? repoSlug(repo) : null
    for (const f of files) {
      try {
        const src = fs.readFileSync(path.join(wfDir, f), 'utf8')
        if (!/^\s*schedule:/m.test(src)) continue
        const cron = src.match(/-\s*cron:\s*['"]?([^'"\n]+)['"]?/)
        found.push({
          repo: repoName,
          kind: 'github-actions',
          name: f.replace(/\.ya?ml$/, ''),
          schedule: cron ? cron[1].trim() : null,
          slug,
          file: f,
        })
      } catch {
        continue
      }
    }
  }

  try {
    const vercel = JSON.parse(fs.readFileSync(path.join(repo, 'vercel.json'), 'utf8'))
    if (Array.isArray(vercel?.crons)) {
      for (const c of vercel.crons.slice(0, 20)) {
        found.push({
          repo: repoName,
          kind: 'vercel-cron',
          name: typeof c?.path === 'string' ? c.path : 'cron',
          schedule: typeof c?.schedule === 'string' ? c.schedule : null,
        })
      }
    }
  } catch {
    // no vercel.json or unreadable — fine
  }

  return found
}

export function scanCloud(cwds: Array<string | null>): CloudAgent[] {
  const repos = candidateRepos(cwds.filter((c): c is string => !!c))
  const all: CloudAgent[] = []
  for (const r of repos) all.push(...scanRepo(r))
  return all
}

// Static repo scan + live agents from connected platforms + GitHub health.
// GitHub enrichment only touches workflows found locally, so it can run in
// parallel with the platform fetches.
export async function collectCloud(cwds: Array<string | null>): Promise<CloudAgent[]> {
  const { enrichCloudAgents } = await import('./github')
  const { providerAgents } = await import('./providers')
  const staticAgents = scanCloud(cwds)
  const [{ agents: platform, active }] = await Promise.all([
    providerAgents(),
    enrichCloudAgents(staticAgents),
  ])
  // The platform API sees ALL Vercel crons (not just local repos) with real
  // status — when it's connected, it replaces the static vercel.json guesses.
  return [
    ...(active.includes('vercel') ? staticAgents.filter((a) => a.kind !== 'vercel-cron') : staticAgents),
    ...platform,
  ]
}
