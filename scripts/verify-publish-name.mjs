import { PACKAGE_NAME, PACKAGE_NAME_AVAILABLE } from '../lib/package-name.js'
import { readFile } from 'node:fs/promises'

const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))

if (!PACKAGE_NAME_AVAILABLE || manifest.name !== PACKAGE_NAME) {
  throw new Error(
    `npm publish is blocked because the manifest does not match the verified canonical PACKAGE_NAME ${PACKAGE_NAME}.`,
  )
}
