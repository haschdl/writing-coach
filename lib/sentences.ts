/**
 * Pragmatic Swedish sentence / region helpers for incremental live analysis.
 * Not a full NLP tokenizer — handles ., !, ?, and newline boundaries.
 */

export type SentenceSpan = {
  start: number
  end: number
  text: string
}

export type AnalysisRegion = {
  /** Primary sentence/region to analyze (local offsets start at 0 within `text`). */
  text: string
  contextBefore: string
  contextAfter: string
  /** Document offset where `text` begins. */
  documentOffset: number
  /** Document range invalidated by the edit (may be wider than text). */
  invalidateStart: number
  invalidateEnd: number
  /** True when we fell back to analyzing the whole document. */
  fullDocument: boolean
}

const SENTENCE_END = /[.!?](?:["')\]]+)?(?=\s|$)/g
/** Below this length, send the full document to the model (still invalidate only the edited sentence). */
const SHORT_DOC_THRESHOLD = 280

/** Split document into sentence-like spans (includes trailing whitespace up to next sentence). */
export function findSentenceSpans(document: string): SentenceSpan[] {
  if (!document) return []

  const spans: SentenceSpan[] = []

  // Also treat newlines as hard breaks when they separate paragraphs.
  const chunks: { start: number; end: number }[] = []
  const paraRe = /\n+/g
  let last = 0
  let match: RegExpExecArray | null
  while ((match = paraRe.exec(document)) !== null) {
    if (match.index > last) chunks.push({ start: last, end: match.index })
    last = match.index + match[0].length
  }
  if (last < document.length) chunks.push({ start: last, end: document.length })
  if (chunks.length === 0 && document.length > 0) chunks.push({ start: 0, end: document.length })

  for (const chunk of chunks) {
    const slice = document.slice(chunk.start, chunk.end)
    SENTENCE_END.lastIndex = 0
    let localCursor = 0
    let m: RegExpExecArray | null
    while ((m = SENTENCE_END.exec(slice)) !== null) {
      const endLocal = m.index + m[0].length
      // Include trailing spaces before next content
      let endWithSpace = endLocal
      while (endWithSpace < slice.length && /[ \t]/.test(slice[endWithSpace]!)) endWithSpace++
      const start = chunk.start + localCursor
      const end = chunk.start + endWithSpace
      const text = document.slice(start, end)
      if (text.trim().length > 0) spans.push({ start, end, text })
      localCursor = endWithSpace
    }
    if (localCursor < slice.length) {
      const start = chunk.start + localCursor
      const end = chunk.end
      const text = document.slice(start, end)
      if (text.trim().length > 0) spans.push({ start, end, text })
    }
  }

  if (spans.length === 0 && document.trim().length > 0) {
    return [{ start: 0, end: document.length, text: document }]
  }
  return spans
}

export function sentenceIndexAt(spans: SentenceSpan[], offset: number): number {
  if (spans.length === 0) return -1
  const last = spans[spans.length - 1]!
  const clamped = Math.max(0, Math.min(offset, last.end))
  for (let i = 0; i < spans.length; i++) {
    const s = spans[i]!
    const isLast = i === spans.length - 1
    // Use half-open [start, end) so a caret on a boundary belongs to the following sentence.
    if (clamped >= s.start && (clamped < s.end || (isLast && clamped <= s.end))) return i
    if (clamped < s.start) return Math.max(0, i - 1)
  }
  return spans.length - 1
}

/**
 * Given previous and next document text, find the edit locus and build an analysis region.
 * Prefers sending the changed sentence ± neighbors rather than the full document.
 * Even when falling back to full-document payload, invalidate only the edited sentence(s).
 */
export function buildAnalysisRegion(previousText: string, nextText: string, caretHint?: number): AnalysisRegion {
  const { start: editStart, endPrev, endNext } = findEditBounds(previousText, nextText)
  // Prefer the edit span itself so boundary carets don't select the previous sentence.
  const locus =
    endNext > editStart
      ? endNext - 1
      : typeof caretHint === 'number'
        ? caretHint
        : editStart
  const spans = findSentenceSpans(nextText)

  if (spans.length === 0) {
    return {
      text: nextText,
      contextBefore: '',
      contextAfter: '',
      documentOffset: 0,
      invalidateStart: 0,
      invalidateEnd: nextText.length,
      fullDocument: true,
    }
  }

  const idx = sentenceIndexAt(spans, Math.min(locus, nextText.length))
  const current = spans[idx]!

  // If the edit crossed sentence boundaries (large replace), widen slightly.
  const startIdx = Math.max(0, editStart < current.start ? sentenceIndexAt(spans, editStart) : idx)
  const endIdx = Math.min(
    spans.length - 1,
    endNext > current.end ? sentenceIndexAt(spans, Math.max(0, endNext - 1)) : idx,
  )

  const regionStartIdx = Math.min(startIdx, idx)
  const regionEndIdx = Math.max(endIdx, idx)
  const regionStart = spans[regionStartIdx]!.start
  const regionEnd = spans[regionEndIdx]!.end
  const regionText = nextText.slice(regionStart, regionEnd)

  const contextBefore = regionStartIdx > 0 ? spans[regionStartIdx - 1]!.text.trim() : ''
  const contextAfter = regionEndIdx < spans.length - 1 ? spans[regionEndIdx + 1]!.text.trim() : ''

  const invalidateStart = regionStart
  const invalidateEnd = regionEnd

  // Short documents: still send full text (simpler for the model) but only invalidate the edited region.
  if (nextText.length <= SHORT_DOC_THRESHOLD || spans.length <= 1) {
    return {
      text: nextText,
      contextBefore: '',
      contextAfter: '',
      documentOffset: 0,
      invalidateStart,
      invalidateEnd,
      fullDocument: true,
    }
  }

  return {
    text: regionText,
    contextBefore,
    contextAfter,
    documentOffset: regionStart,
    invalidateStart,
    invalidateEnd,
    fullDocument: false,
  }
}

function findEditBounds(previousText: string, nextText: string) {
  let start = 0
  const minLen = Math.min(previousText.length, nextText.length)
  while (start < minLen && previousText[start] === nextText[start]) start++

  let endPrev = previousText.length
  let endNext = nextText.length
  while (
    endPrev > start &&
    endNext > start &&
    previousText[endPrev - 1] === nextText[endNext - 1]
  ) {
    endPrev--
    endNext--
  }

  return { start, endPrev, endNext }
}

/** Map model-local offsets into document coordinates. */
export function toDocumentOffsets(
  localStart: number,
  localEnd: number,
  documentOffset: number,
): { start: number; end: number } {
  return {
    start: documentOffset + localStart,
    end: documentOffset + localEnd,
  }
}

/** True if the last non-whitespace char in the changed region is sentence-ending punctuation. */
export function endsWithSentencePunctuation(text: string): boolean {
  const trimmed = text.replace(/\s+$/u, '')
  return /[.!?]$/u.test(trimmed)
}

export function debounceMsForEdit(nextText: string, regionText: string): number {
  // Slightly faster after completing a sentence; a bit slower mid-sentence.
  if (endsWithSentencePunctuation(regionText) || endsWithSentencePunctuation(nextText)) {
    return 700
  }
  return 1000
}
