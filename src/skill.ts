import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-skill'

export const name = 'vision-bridge-skill'
export const inject = ['skills']

const skillFile = new URL('../skills/vision-bridge/SKILL.md', import.meta.url)
const resourceDirectory = new URL('../skills/vision-bridge/', import.meta.url)

function loadSkill(): { description: string; content: string } {
  const source = readFileSync(skillFile, 'utf8')
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/u.exec(source)
  if (!match) throw new Error('bundled vision-bridge SKILL.md has invalid frontmatter')
  const description = /^description:\s*(.+)$/mu.exec(match[1] ?? '')?.[1]?.trim()
  if (!description) throw new Error('bundled vision-bridge SKILL.md requires a description')
  return { description, content: (match[2] ?? '').trim() }
}

export function apply(ctx: Context) {
  const skill = loadSkill()
  return ctx.skills.register({
    name: 'vision-bridge',
    description: skill.description,
    source: 'bundled',
    content: skill.content,
    invocation: { modelInvocable: true, userInvocable: true },
    resourceBase: { kind: 'directory', path: fileURLToPath(resourceDirectory) },
  })
}
