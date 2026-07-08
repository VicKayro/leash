import {
  PROVIDERS,
  resolveProvider,
  saveProviderToken,
  removeProviderToken,
  validateProvider,
  type ProviderId,
} from './scan/providers'

const isProvider = (s: string): s is ProviderId => PROVIDERS.some((p) => p.id === s)

function status(): void {
  console.log('\nCloud providers — where your agents run\n')
  for (const p of PROVIDERS) {
    const cred = resolveProvider(p.id)
    if (cred) {
      console.log(`  ✓ ${p.label.padEnd(19)} via ${cred.source}`)
    } else {
      console.log(`  ○ ${p.label.padEnd(19)} getleash link ${p.id} <token>`)
      console.log(`    ${''.padEnd(19)} create one (read-only is enough): ${p.tokenUrl}`)
    }
  }
  console.log(`
Connected platforms show up health-checked in every report and on your
fleet dashboard. Tokens stay in ~/.leash/providers.json (chmod 600), are
only ever sent to their own platform's API, read-only, never to leash.

  Remove one:  getleash link <provider> --off
`)
}

export async function linkCommand(args: string[]): Promise<void> {
  const id = args[0]
  if (!id) return status()
  if (!isProvider(id)) {
    console.error(`leash: unknown provider "${id}". One of: ${PROVIDERS.map((p) => p.id).join(', ')}`)
    process.exitCode = 1
    return
  }
  if (args.includes('--off')) {
    removeProviderToken(id)
    console.log(`\n${id} unlinked (env vars and CLI logins, if any, still apply).\n`)
    return
  }
  const token = args[1]
  if (!token || token.startsWith('--')) {
    const meta = PROVIDERS.find((p) => p.id === id)!
    console.error(`leash: paste a token — getleash link ${id} <token>\nCreate one (read-only is enough): ${meta.tokenUrl}`)
    process.exitCode = 1
    return
  }
  process.stdout.write(`Checking the token against ${id}… `)
  if (!(await validateProvider(id, token))) {
    console.log('rejected.')
    console.error(`leash: ${id} did not accept this token. Nothing was saved.`)
    process.exitCode = 1
    return
  }
  console.log('valid.')
  saveProviderToken(id, token)
  console.log(`
${id} is linked. Your next report and dashboard push include it:
  npx getleash
`)
}
