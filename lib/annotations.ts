import type { Annotation, Category, PatternSummary } from '@/lib/feedback-types'

const CATEGORY_LABELS: Record<Category, string> = {
  spelling: 'Spelling',
  word_order: 'Word order',
  subordinate_clause: 'Subordinate clause',
  noun_gender: 'Noun gender',
  adjective_agreement: 'Adjective agreement',
  verb_form: 'Verb form',
  pronoun: 'Pronoun',
  reflexive: 'Reflexive',
  idiomatic: 'Natural phrasing',
  style: 'Style',
  positive: 'Good usage',
}

export function categoryDisplayLabel(category: string): string {
  return (CATEGORY_LABELS as Record<string, string>)[category] ?? category.replaceAll('_', ' ')
}

/**
 * After an edit that changes document length by `delta` starting at `editStart`,
 * shift annotations that sit entirely after the edit, and drop those that overlap
 * the invalidated document range [invalidateStart, invalidateEnd) in the NEW text
 * (or that overlapped the pre-edit changed span).
 *
 * Strategy:
 * 1. Remap by comparing previous→next via a simple prefix/suffix edit model.
 * 2. Drop anything overlapping the invalidate range in the new document.
 */
export function preserveAnnotationsAfterEdit(
  previousAnnotations: Annotation[],
  previousText: string,
  nextText: string,
  invalidateStart: number,
  invalidateEnd: number,
): Annotation[] {
  const { start: editStart, endPrev, endNext } = findEditBounds(previousText, nextText)
  const delta = endNext - endPrev

  return previousAnnotations.flatMap((annotation) => {
    // Completely before the edit — unchanged.
    if (annotation.end <= editStart) {
      if (overlaps(annotation.start, annotation.end, invalidateStart, invalidateEnd)) return []
      return [annotation]
    }

    // Completely after the removed/replaced span in the previous text — shift by delta.
    if (annotation.start >= endPrev) {
      const shifted: Annotation = {
        ...annotation,
        start: annotation.start + delta,
        end: annotation.end + delta,
      }
      if (shifted.end > nextText.length || shifted.start < 0) return []
      if (nextText.slice(shifted.start, shifted.end) !== annotation.text) {
        // Text drift — drop rather than mis-highlight.
        return []
      }
      if (overlaps(shifted.start, shifted.end, invalidateStart, invalidateEnd)) return []
      return [shifted]
    }

    // Overlaps the edited span — invalidate.
    return []
  })
}

function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number) {
  return aStart < bEnd && aEnd > bStart
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

/** Merge new regional annotations into preserved ones; newer wins on overlap. */
export function mergeAnnotations(preserved: Annotation[], incoming: Annotation[]): Annotation[] {
  const withoutOverlap = preserved.filter(
    (existing) => !incoming.some((next) => overlaps(existing.start, existing.end, next.start, next.end)),
  )
  return [...withoutOverlap, ...incoming].sort((a, b) => a.start - b.start)
}

export function aggregatePatterns(annotations: Annotation[]): PatternSummary[] {
  const counts = new Map<string, { category: string; label: string; count: number }>()
  for (const annotation of annotations) {
    if (annotation.kind === 'positive' || annotation.category === 'positive') continue
    const key = annotation.category
    const existing = counts.get(key)
    if (existing) {
      existing.count += 1
    } else {
      counts.set(key, {
        category: key,
        label: annotation.label || categoryDisplayLabel(key),
        count: 1,
      })
    }
  }
  return [...counts.values()].sort((a, b) => b.count - a.count)
}

export function patternsSummarySentence(patterns: PatternSummary[]): string {
  if (patterns.length === 0) {
    return 'No major patterns to notice yet. Keep writing and pause when you want feedback.'
  }
  const top = patterns.slice(0, 2).map((p) => p.label.toLowerCase())
  if (top.length === 1) {
    return `A few places touch on ${top[0]}. See if you can spot the pattern before asking for a hint.`
  }
  return `A few sentences have ${top[0]} and ${top[1]} worth reviewing. See if you can spot the pattern before asking for a hint.`
}

export function normalizeLiveAnnotations(
  value: unknown,
  sourceText: string,
  documentOffset = 0,
): Annotation[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item, index) => {
    if (!item || typeof item !== 'object') return []
    const candidate = item as Record<string, unknown>
    const localStart = Number(candidate.start)
    const localEnd = Number(candidate.end)
    if (!Number.isInteger(localStart) || !Number.isInteger(localEnd) || localStart < 0 || localEnd <= localStart) {
      return []
    }
    if (localEnd > sourceText.length) return []

    const reportedText = typeof candidate.text === 'string' ? candidate.text : ''
    let resolvedLocalStart = localStart
    let resolvedLocalEnd = localEnd
    if (reportedText && sourceText.slice(localStart, localEnd) !== reportedText) {
      const found = sourceText.indexOf(reportedText)
      if (found < 0) return []
      resolvedLocalStart = found
      resolvedLocalEnd = found + reportedText.length
    }

    const start = documentOffset + resolvedLocalStart
    const end = documentOffset + resolvedLocalEnd
    const text = sourceText.slice(resolvedLocalStart, resolvedLocalEnd)
    const category = (typeof candidate.category === 'string' ? candidate.category : 'style') as Category
    const kindRaw = typeof candidate.kind === 'string' ? candidate.kind : undefined
    const kind =
      kindRaw === 'error' || kindRaw === 'naturalness' || kindRaw === 'positive'
        ? kindRaw
        : category === 'positive'
          ? 'positive'
          : category === 'idiomatic' || category === 'style'
            ? 'naturalness'
            : 'error'

    return [{
      id: typeof candidate.id === 'string' ? candidate.id : `annotation-${documentOffset}-${index}`,
      start,
      end,
      text,
      category,
      label: typeof candidate.label === 'string' ? candidate.label : categoryDisplayLabel(category),
      kind,
      hint: typeof candidate.hint === 'string' ? candidate.hint : '',
      confidence: typeof candidate.confidence === 'number' ? candidate.confidence : undefined,
    }]
  })
}
