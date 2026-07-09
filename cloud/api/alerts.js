import { put, list, del } from '@vercel/blob'

const TOKEN_RE = /^flt_[a-f0-9]{16,64}$/
// Discord webhook URLs only — the one channel Watchdog speaks in the beta.
// WATCHDOG_ALLOW_ANY_WEBHOOK exists for the local test harness; never set in prod.
const DISCORD_RE = process.env.WATCHDOG_ALLOW_ANY_WEBHOOK
  ? /^https?:\/\//
  : /^https:\/\/(?:discord\.com|discordapp\.com)\/api\/webhooks\/\d+\/[\w-]+$/

async function readAlerts(token) {
  const { blobs } = await list({ prefix: `fleets/${token}/_alerts.json`, limit: 1 })
  if (!blobs.length) return null
  try {
    const r = await fetch(blobs[0].url, { cache: 'no-store' })
    return r.ok ? await r.json() : null
  } catch {
    return null
  }
}

export default async function handler(req, res) {
  const body = req.method === 'GET' ? req.query : (req.body ?? {})
  const token = String(body.token ?? req.query.token ?? '')
  if (!TOKEN_RE.test(token)) {
    res.status(400).json({ error: 'bad fleet token' })
    return
  }

  if (req.method === 'GET') {
    const alerts = await readAlerts(token)
    res.setHeader('Cache-Control', 'no-store')
    res.status(200).json({ armed: !!alerts?.discord, channel: alerts?.discord ? 'discord' : null })
    return
  }

  if (req.method === 'DELETE') {
    await del(`fleets/${token}/_alerts.json`).catch(() => {})
    res.status(200).json({ ok: true, armed: false })
    return
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'GET, POST or DELETE' })
    return
  }
  const discord = String(body.discord ?? '')
  if (!DISCORD_RE.test(discord)) {
    res.status(400).json({ error: 'not a Discord webhook URL (expected https://discord.com/api/webhooks/…)' })
    return
  }
  // Prove the webhook works before saving anything.
  let ok = false
  try {
    const host = req.headers['x-forwarded-host'] || req.headers.host || 'getleash.vercel.app'
    const test = await fetch(discord, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        embeds: [{
          title: '🐕 Watchdog armed',
          description: `This channel now gets pinged the moment an agent dies, loops, or fails.\n[Fleet dashboard](https://${host}/f/${token})`,
          color: 0x4ade80,
          footer: { text: 'leash watchdog' },
        }],
      }),
      signal: AbortSignal.timeout(5000),
    })
    ok = test.ok || test.status === 204
  } catch {}
  if (!ok) {
    res.status(400).json({ error: 'Discord rejected the webhook — check the URL' })
    return
  }
  await put(`fleets/${token}/_alerts.json`, JSON.stringify({ discord, armedAt: new Date().toISOString() }), {
    access: 'public',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/json',
  })
  res.status(200).json({ ok: true, armed: true })
}
