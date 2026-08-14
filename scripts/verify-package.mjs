import { access, readFile } from 'node:fs/promises'
import { PACKAGE_NAME, PACKAGE_NAME_AVAILABLE } from '../lib/package-name.js'

const required = [
  'lib/index.js',
  'lib/index.d.ts',
  'lib/skill.js',
  'lib/skill.d.ts',
  'lib/client.js',
  'lib/client/index.d.ts',
  'skills/vision-bridge/SKILL.md',
  'skills/vision-bridge/references/usage.md',
  'skills/vision-bridge/references/security.md',
  'cordis.patch.yml',
]

await Promise.all(required.map((path) => access(new URL(`../${path}`, import.meta.url))))

const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
if (manifest.name !== PACKAGE_NAME || manifest.version !== '0.1.0') {
  throw new Error('unexpected package identity')
}
if (PACKAGE_NAME_AVAILABLE !== true || manifest.scripts?.prepublishOnly !== 'node scripts/verify-publish-name.mjs') {
  throw new Error('npm package identity is not release-ready')
}
if (manifest.dsh?.bundle?.patch !== './cordis.patch.yml') {
  throw new Error('missing dsh.bundle.patch')
}
if (manifest.dsh?.client?.platform !== 'web' || manifest.exports?.['./client'] === undefined) {
  throw new Error('missing dsh.client Web bundle declaration')
}
