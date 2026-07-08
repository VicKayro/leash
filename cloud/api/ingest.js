import { put } from '@vercel/blob'

const TOKEN_RE = /^flt_[a-f0-9]{16,64}$/
const MACHINE_RE = /^[a-z0-9][a-z0-9-]{2,40}$/
const MAX_BODY = 200_000

const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '')

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

  const record = JSON.stringify({
    receivedAt: new Date().toISOString(),
    machine: {
      id: machine.id,
      host: str(machine.host, 64) || 'unknown',
      platform: str(machine.platform, 16),
      cliVersion: str(machine.cliVersion, 16),
    },
    snapshot,
  })
  if (record.length > MAX_BODY) {
    res.status(413).json({ error: 'snapshot too large' })
    return
  }

  await put(`fleets/${token}/${machine.id}.json`, record, {
    access: 'public',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/json',
  })
  res.status(200).json({ ok: true })
}
