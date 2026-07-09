import { put, list } from '@vercel/blob'

const TOKEN_RE = /^flt_[a-f0-9]{16,64}$/
const MACHINE_RE = /^[a-z0-9][a-z0-9-]{2,40}$/
const MAX_BODY = 200_000

const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '')

const KIND = {
  'github-actions': 'GitHub Actions', 'vercel-cron': 'Vercel', 'render-cron': 'Render',
  railway: 'Railway', 'cloudflare-worker': 'Cloudflare',
}

// Every problem in a snapshot, keyed so two pushes can be diffed.
function issuesOf(snapshot) {
  const out = []
  for (const i of snapshot?.scheduled?.issues ?? []) {
    out.push({ key: `sched:${i.label}:${i.problem}`, text: `**${i.label}** — ${i.problem} (${i.source})` })
  }
  for (const i of snapshot?.cloudAgents?.issues ?? []) {
    const name = String(i.name ?? '').startsWith('/') ? `${i.repo}${i.name}` : `${i.repo}/${i.name}`
    out.push({ key: `cloud:${name}:${i.status}`, text: `**${name}** — ${i.status} (${KIND[i.kind] ?? i.kind}${i.note ? ': ' + i.note : ''})` })
  }
  for (const l of snapshot?.loops ?? []) {
    out.push({ key: `loop:${l.project}:${l.tool}:${l.date}`, text: `**loop in ${l.project}** — ${l.tool} ×${l.count} (~$${(l.estCostUSD ?? 0).toFixed(2)}, ${l.date})` })
  }
  return out
}

// The watchdog barks on NEW problems only — whatever this machine's previous
// push already reported stays quiet.
async function bark({ token, machineHost, snapshot, prevUrl, alertsUrl, host }) {
  if (!alertsUrl) return
  let prev = null
  let alerts = null
  try {
    const [p, a] = await Promise.all([
      prevUrl ? fetch(prevUrl, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)) : null,
      fetch(alertsUrl, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)),
    ])
    prev = p
    alerts = a
  } catch {}
  if (!alerts?.discord) return
  const seen = new Set(issuesOf(prev?.snapshot).map((i) => i.key))
  const fresh = issuesOf(snapshot).filter((i) => !seen.has(i.key))
  if (!fresh.length) return
  await fetch(alerts.discord, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      embeds: [{
        title: `🐕 Watchdog — ${machineHost}`,
        description: fresh.slice(0, 10).map((i) => `✗ ${i.text}`).join('\n') +
          (fresh.length > 10 ? `\n… and ${fresh.length - 10} more` : '') +
          `\n\n[Fleet dashboard](https://${host}/f/${token})`,
        color: 0xf87171,
        footer: { text: 'leash watchdog' },
        timestamp: new Date().toISOString(),
      }],
    }),
    signal: AbortSignal.timeout(5000),
  }).catch(() => {})
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST only' })
    return
  }
  const { token, machine, snapshot } = req.body ?? {}
  if (!TOKEN_RE.test(String(token ?? ''))) {
    res.status(400).json({ error: 'bad fleet token' })
    return
  }
  if (!machine || !MACHINE_RE.test(String(machine.id ?? ''))) {
    res.status(400).json({ error: 'bad machine id' })
    return
  }
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    res.status(400).json({ error: 'bad snapshot' })
    return
  }

  const machineHost = str(machine.host, 64) || 'unknown'
  const record = JSON.stringify({
    receivedAt: new Date().toISOString(),
    machine: {
      id: machine.id,
      host: machineHost,
      platform: str(machine.platform, 16),
      cliVersion: str(machine.cliVersion, 16),
    },
    snapshot,
  })
  if (record.length > MAX_BODY) {
    res.status(413).json({ error: 'snapshot too large' })
    return
  }

  // One listing gives us both the previous snapshot (for the diff) and the
  // alert config — grab their URLs before the overwrite below.
  let prevUrl = null
  let alertsUrl = null
  try {
    const { blobs } = await list({ prefix: `fleets/${token}/`, limit: 60 })
    for (const b of blobs) {
      if (b.pathname.endsWith(`/${machine.id}.json`)) prevUrl = b.url
      if (b.pathname.endsWith('/_alerts.json')) alertsUrl = b.url
    }
  } catch {}

  const barking = bark({
    token,
    machineHost,
    snapshot,
    prevUrl,
    alertsUrl,
    host: req.headers['x-forwarded-host'] || req.headers.host || 'getleash.vercel.app',
  })

  await put(`fleets/${token}/${machine.id}.json`, record, {
    access: 'public',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/json',
  })
  await barking.catch(() => {})
  res.status(200).json({ ok: true })
}
