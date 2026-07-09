import { list } from '@vercel/blob'

const TOKEN_RE = /^flt_[a-f0-9]{16,64}$/

export default async function handler(req, res) {
  const token = String(req.query.token ?? '')
  if (!TOKEN_RE.test(token)) {
    res.status(400).json({ error: 'bad fleet token' })
    return
  }
  const { blobs } = await list({ prefix: `fleets/${token}/`, limit: 50 })
  const watchdog = blobs.some((b) => b.pathname.endsWith('/_alerts.json'))
  const machines = (
    await Promise.all(
      blobs.filter((b) => !b.pathname.split('/').pop().startsWith('_')).map(async (b) => {
        try {
          const r = await fetch(b.url, { cache: 'no-store' })
          return r.ok ? await r.json() : null
        } catch {
          return null
        }
      }),
    )
  ).filter(Boolean)
  machines.sort((a, b) => String(b.receivedAt).localeCompare(String(a.receivedAt)))
  res.setHeader('Cache-Control', 'no-store')
  res.status(200).json({ machines, watchdog })
}
