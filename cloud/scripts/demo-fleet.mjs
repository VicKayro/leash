// Push a curated demo fleet to prod — the README's live demo link.
const TOKEN = 'flt_cafebabe00decafbad00face'
const API = 'https://getleash.vercel.app/api/ingest'

const now = Date.now()
const day = (i) => new Date(now - i * 86400e3).toISOString().slice(0, 10)
const at = (i, h, m = 0) => { const d = new Date(now - i * 86400e3); d.setHours(h, m, 0, 0); return d.getTime() }

// A believable 30-day cost curve: weekday humps, one spike.
const curve = [4, 9, 12, 3, 0, 14, 22, 18, 25, 9, 0, 4, 31, 27, 16, 41, 12, 0, 7, 24, 33, 19, 52, 11, 3, 28, 38, 44, 61, 47]
const daily = curve.map((c, idx) => ({ date: day(29 - idx), costUSD: c + (idx % 3) * 0.87 }))
const total = daily.reduce((a, d) => a + d.costUSD, 0)

const machines = [
  {
    id: 'demo1aa2bb3c', host: 'atlas.local', platform: 'darwin',
    snapshot: {
      totals: { costUSD: total, sessions: 214, projects: 6, todayUSD: daily[29].costUSD },
      daily,
      roi: { mult: Math.round((total / 200) * 10) / 10, plan: '$200/mo Max' },
      lastActivityAt: now - 4 * 60e3,
      insights: {
        nightSessions: 11, activeDays: 26, totalToolCalls: 18422,
        topTools: [{ tool: 'Bash', count: 7211 }, { tool: 'Edit', count: 5108 }, { tool: 'Read', count: 3390 }],
        topSession: { project: 'rag-pipeline', date: day(6), costUSD: 96.4 },
      },
      topProjects: [
        { name: 'rag-pipeline', costUSD: total * 0.44, sessions: 71, lastActivity: now - 4 * 60e3 },
        { name: 'agent-fleet', costUSD: total * 0.27, sessions: 58, lastActivity: now - 3 * 3600e3 },
        { name: 'billing-bot', costUSD: total * 0.14, sessions: 34, lastActivity: now - 86400e3 },
        { name: 'docs-writer', costUSD: total * 0.09, sessions: 29, lastActivity: now - 2 * 86400e3 },
        { name: 'infra', costUSD: total * 0.06, sessions: 22, lastActivity: now - 5 * 86400e3 },
      ],
      nights: [
        { project: 'rag-pipeline', startTs: at(1, 0, 20), endTs: at(1, 2, 5), costUSD: 21.3, toolCalls: 412 },
        { project: 'agent-fleet', startTs: at(1, 4, 40), endTs: at(1, 6, 15), costUSD: 9.8, toolCalls: 188 },
        { project: 'billing-bot', startTs: at(2, 1, 10), endTs: at(2, 1, 55), costUSD: 6.4, toolCalls: 97 },
        { project: 'rag-pipeline', startTs: at(4, 3, 0), endTs: at(4, 5, 30), costUSD: 17.9, toolCalls: 341 },
        { project: 'docs-writer', startTs: at(6, 0, 45), endTs: at(6, 1, 30), costUSD: 4.1, toolCalls: 66 },
      ],
      loops: [{ project: 'billing-bot', tool: 'Bash', count: 14, date: day(3), estCostUSD: 11.2 }],
      scheduled: {
        total: 7,
        issues: [
          { label: 'com.acme.nightly-sync', source: 'launchd', schedule: 'daily at 03:00', problem: 'zombie' },
        ],
      },
      cloudAgents: { total: 9, checked: 9, byKind: { 'github-actions': 6, 'vercel-cron': 3 }, issues: [
        { repo: 'acme/etl', name: 'refresh-embeddings', kind: 'github-actions', status: 'failing', note: 'last run failure 6h ago' },
      ] },
      guard: { dailyUSD: 80, hourlyUSD: 20 },
      v: 2, generatedAt: new Date().toISOString(), windowDays: 30,
    },
  },
  {
    id: 'demo4dd5ee6f', host: 'hetzner-worker-1', platform: 'linux',
    snapshot: {
      totals: { costUSD: 212.4, sessions: 388, projects: 2, todayUSD: 8.1 },
      daily: daily.map((d) => ({ date: d.date, costUSD: Math.round(d.costUSD * 34) / 100 })),
      roi: null,
      lastActivityAt: now - 21 * 60e3,
      insights: { nightSessions: 62, activeDays: 30, totalToolCalls: 51209, topTools: [{ tool: 'Bash', count: 30110 }, { tool: 'Read', count: 12400 }], topSession: { project: 'scraper-swarm', date: day(11), costUSD: 12.7 } },
      topProjects: [
        { name: 'scraper-swarm', costUSD: 148.9, sessions: 301, lastActivity: now - 21 * 60e3 },
        { name: 'report-factory', costUSD: 63.5, sessions: 87, lastActivity: now - 7 * 3600e3 },
      ],
      nights: [
        { project: 'scraper-swarm', startTs: at(1, 2, 0), endTs: at(1, 6, 45), costUSD: 4.9, toolCalls: 1730 },
        { project: 'scraper-swarm', startTs: at(2, 2, 0), endTs: at(2, 6, 40), costUSD: 5.2, toolCalls: 1811 },
        { project: 'report-factory', startTs: at(3, 5, 0), endTs: at(3, 6, 20), costUSD: 2.1, toolCalls: 402 },
      ],
      loops: [],
      scheduled: { total: 12, issues: [{ label: 'certbot-renew-report', source: 'cron', schedule: 'weekly', problem: 'silent' }] },
      cloudAgents: { total: 4, checked: 4, byKind: { 'github-actions': 4 }, issues: [] },
      guard: { dailyUSD: 15 },
      v: 2, generatedAt: new Date().toISOString(), windowDays: 30,
    },
  },
  {
    id: 'demo7aa8bb9c', host: 'ci-runner', platform: 'linux',
    snapshot: {
      totals: { costUSD: 74.2, sessions: 141, projects: 1, todayUSD: 2.3 },
      daily: daily.map((d) => ({ date: d.date, costUSD: Math.round(d.costUSD * 12) / 100 })),
      roi: null,
      lastActivityAt: now - 3 * 3600e3,
      insights: { nightSessions: 19, activeDays: 22, totalToolCalls: 9004, topTools: [{ tool: 'Bash', count: 6100 }], topSession: { project: 'pr-review-bot', date: day(2), costUSD: 4.8 } },
      topProjects: [{ name: 'pr-review-bot', costUSD: 74.2, sessions: 141, lastActivity: now - 3 * 3600e3 }],
      nights: [{ project: 'pr-review-bot', startTs: at(1, 1, 15), endTs: at(1, 1, 40), costUSD: 0.9, toolCalls: 120 }],
      loops: [],
      scheduled: { total: 2, issues: [] },
      cloudAgents: { total: 3, checked: 2, byKind: { 'github-actions': 3 }, issues: [] },
      guard: null,
      v: 2, generatedAt: new Date().toISOString(), windowDays: 30,
    },
  },
]

for (const m of machines) {
  const { id, host, platform, snapshot } = m
  const res = await fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: TOKEN, machine: { id, host, platform, cliVersion: '0.12.0' }, snapshot }),
  })
  console.log(host, res.status, await res.text())
}
console.log('demo fleet: https://getleash.vercel.app/f/' + TOKEN)
