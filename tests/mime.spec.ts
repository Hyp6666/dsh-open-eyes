import { readFileSync } from 'node:fs'
import { detectImage } from '@deepseek-ai/dsh-attachment-local'
import { describe, expect, it } from 'vitest'
import { detectImageMime } from '../src/mime.js'

const fixture = (name: string) => readFileSync(new URL(`../fixtures/${name}`, import.meta.url))

describe('image MIME detection', () => {
  it.each([
    ['tiny.png', 'image/png'],
    ['tiny.jpg', 'image/jpeg'],
    ['tiny.webp', 'image/webp'],
    ['tiny.gif', 'image/gif'],
  ] as const)('recognizes %s from magic bytes', (name, mime) => {
    expect(detectImageMime(fixture(name))).toBe(mime)
  })

  it.each([
    ['tiny.png', 'image/png'],
    ['tiny.jpg', 'image/jpeg'],
    ['tiny.webp', 'image/webp'],
    ['tiny.gif', 'image/gif'],
  ] as const)('fully decodes %s with the official DSH attachment implementation', async (name, mime) => {
    await expect(detectImage(fixture(name))).resolves.toEqual({
      mediaType: mime,
      width: 8,
      height: 8,
    })
  })

  it('does not trust a forged extension', () => {
    expect(detectImageMime(fixture('invalid.bin'))).toBeNull()
    expect(detectImageMime(Buffer.from('not a png'))).toBeNull()
  })

  it.each([
    Buffer.from([0x89, 0x50, 0x4e]),
    Buffer.from([0xff, 0xd8]),
    Buffer.from('RIFF'),
    Buffer.from('GIF89'),
  ])('rejects a truncated header', (bytes) => {
    expect(detectImageMime(bytes)).toBeNull()
  })
})
