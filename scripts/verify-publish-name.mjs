import { PACKAGE_NAME, PACKAGE_NAME_AVAILABLE } from '../lib/package-name.js'
import { readFile } from 'node:fs/promises'

const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))

const EXPECTED_REPOSITORY = 'git+https://github.com/Hyp6666/dsh-open-eyes.git'

if (
  !PACKAGE_NAME_AVAILABLE
  || manifest.name !== PACKAGE_NAME
  || manifest.repository?.url !== EXPECTED_REPOSITORY
  || manifest.license !== 'MIT'
) {
  throw new Error(
    `npm publish is blocked because the manifest does not match the reviewed identity for ${PACKAGE_NAME}.`,
  )
}
