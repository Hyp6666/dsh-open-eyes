/**
 * Presentation-layer projection for bridged user turns.
 *
 * The durable user turn keeps its exact text (the model-facing truth: the
 * original question plus concise Markdown links to session-bound
 * vision-bridge attachment references). This module only upgrades how the
 * chat history RENDERS such a turn: the attachment links are re-expressed as
 * the official image-attachment content blocks the stock user renderer
 * already knows how to display (thumbnail gallery above the bubble), and the
 * remaining text keeps the user's own words only.
 *
 * No node data is mutated — the projection derives a view-only content array
 * for rendering. Messages without bridge links are returned unchanged so the
 * caller can hand the stock renderer its original props.
 */

export const ATTACHMENT_LINK_LABEL = 'Attached image'
export const BRIDGE_REFERENCE_FIELD = 'visionBridgeReference'

export interface ChatContentBlock {
  readonly type: string
  readonly text?: string
  readonly attachment?: unknown
  readonly [key: string]: unknown
}

export interface BridgeContentProjection {
  /** True when the message contains at least one bridge attachment link. */
  readonly bridged: boolean
  /** View-only content blocks for the stock renderer; original array when not bridged. */
  readonly content: readonly ChatContentBlock[]
  /** The user's question with bridge link lines removed; empty when the message was links only. */
  readonly question: string
}

/** One `[Attached image N](vision-bridge://attachment/v1/...)` match inside message text. */
interface LinkMatch {
  readonly start: number
  readonly end: number
}

const LINK_PATTERN = /\[Attached image \d+\]\(vision-bridge:\/\/attachment\/v1\/[^)\s]+\)/gu

/**
 * Collect the bridge attachment link occurrences in a text block. The pattern
 * intentionally mirrors the exact shape `buildBridgePrompt` emits, so foreign
 * markdown or a model typing similar text in an assistant block never matches.
 */
function findBridgeLinks(text: string): LinkMatch[] {
  const links: LinkMatch[] = []
  for (const match of text.matchAll(LINK_PATTERN)) {
    if (match[0] === undefined) continue
    links.push({ start: match.index, end: match.index + match[0].length })
  }
  return links
}

/**
 * Project one content block array. Text blocks keep their non-link text;
 * every bridge link becomes one `{ type: 'image', attachment }` block placed
 * in link order after the question text, matching the stock renderer's
 * expectation (gallery renders before the bubble text within the user row).
 */
export function projectBridgeContent(content: readonly ChatContentBlock[]): BridgeContentProjection {
  const images: { type: 'image'; attachment: unknown }[] = []
  const textParts: string[] = []
  const rest: ChatContentBlock[] = []
  let bridged = false

  for (const block of content) {
    if (block.type !== 'text' || typeof block.text !== 'string') {
      rest.push(block)
      continue
    }
    const links = findBridgeLinks(block.text)
    if (links.length === 0) {
      textParts.push(block.text)
      continue
    }
    bridged = true
    let cursor = 0
    let kept = ''
    for (const link of links) {
      kept += block.text.slice(cursor, link.start)
      cursor = link.end
      const url = block.text.slice(link.start, link.end)
      const target = url.slice(url.indexOf('](', 1) + 2, -1)
      images.push({ type: 'image', attachment: decodeAttachmentReference(target) })
    }
    kept += block.text.slice(cursor)
    textParts.push(stripGeneratedAttachmentSeparator(block.text, links, kept))
  }

  if (!bridged) return { bridged: false, content, question: textOf(content) }
  const question = textParts.join('')
  const parts: ChatContentBlock[] = []
  if (question !== '') parts.push({ type: 'text', text: question })
  parts.push(...images)
  parts.push(...rest)
  return { bridged: true, content: parts, question }
}

/** Remove only the two newlines added by buildBridgePrompt, never user text. */
function stripGeneratedAttachmentSeparator(text: string, links: readonly LinkMatch[], generic: string): string {
  const first = links[0]
  const last = links.at(-1)
  if (first === undefined || last === undefined || text.slice(last.end) !== '') return generic
  for (let index = 1; index < links.length; index += 1) {
    if (text.slice(links[index - 1]!.end, links[index]!.start) !== '\n') return generic
  }
  const prefix = text.slice(0, first.start)
  return prefix.endsWith('\n\n') ? prefix.slice(0, -2) : prefix
}

function textOf(content: readonly ChatContentBlock[]): string {
  return content
    .filter((block) => block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('')
}

/**
 * Parse the `vision-bridge://attachment/v1/...` URL back into the durable
 * attachment descriptor the renderer's image loader consumes. Mirrors the
 * token shape `encodeWebAttachmentReference` writes; tolerant because this is
 * presentation only — an undecodable token renders nothing rather than
 * breaking the row.
 */
function decodeAttachmentReference(value: string): unknown {
  try {
    const url = new URL(value)
    const segments = url.pathname.split('/').filter(Boolean)
    if (segments.length !== 3 || segments[0] !== 'v1') return null
    const attachmentId = decodeURIComponent(segments[2] ?? '')
    const media = url.searchParams.get('media') ?? 'image/png'
    const bytes = Number(url.searchParams.get('bytes') ?? '0')
    const width = Number(url.searchParams.get('width') ?? '0')
    const height = Number(url.searchParams.get('height') ?? '0')
    const name = url.searchParams.get('name') ?? undefined
    if (!attachmentId) return null
    return {
      attachmentId,
      mediaType: media,
      [BRIDGE_REFERENCE_FIELD]: value,
      ...(Number.isSafeInteger(bytes) && bytes > 0 ? { bytes } : {}),
      ...(Number.isSafeInteger(width) && width > 0 ? { width } : {}),
      ...(Number.isSafeInteger(height) && height > 0 ? { height } : {}),
      ...(name !== undefined ? { name } : {}),
    }
  } catch {
    return null
  }
}
