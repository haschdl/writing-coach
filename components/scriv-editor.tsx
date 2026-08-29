'use client'

import { useEffect, useRef, useState } from 'react'
import { ChevronDown, Lightbulb, Settings2, Sparkles, X } from 'lucide-react'

import {
  aggregatePatterns,
  mergeAnnotations,
  normalizeLiveAnnotations,
  patternsSummarySentence,
  preserveAnnotationsAfterEdit,
} from '@/lib/annotations'
import type { Annotation, Category } from '@/lib/feedback-types'
import { buildAnalysisRegion, debounceMsForEdit, findSentenceSpans, sentenceIndexAt } from '@/lib/sentences'

const sampleText =
  'Igår jag gick till affären eftersom jag hade inte någon mjölk hemma. Jag köpte ett banan och några andra saker. Efter det träffade jag min kompis och vi pratade om jobbet. Det var en mycket rolig kväll.'

const demoAnnotations: Annotation[] = [
  {
    id: 'v2',
    start: 0,
    end: 13,
    text: 'Igår jag gick',
    category: 'word_order',
    label: 'Word order',
    kind: 'error',
    hint: 'The sentence starts with a time expression. What normally comes immediately after it in a Swedish main clause?',
  },
  {
    id: 'sub',
    start: 40,
    end: 49,
    text: 'hade inte',
    category: 'subordinate_clause',
    label: 'Subordinate clause',
    kind: 'error',
    hint: 'Look at the word order after “eftersom”. Does this clause follow the same pattern as a main clause?',
  },
  {
    id: 'gender',
    start: 79,
    end: 88,
    text: 'ett banan',
    category: 'noun_gender',
    label: 'Noun gender',
    kind: 'error',
    hint: 'Which article usually goes with “banan”? Try saying the noun with both “en” and “ett”.',
  },
  {
    id: 'natural',
    start: 180,
    end: 195,
    text: 'en mycket rolig',
    category: 'idiomatic',
    label: 'Natural Swedish',
    kind: 'naturalness',
    hint: 'This is understandable. How might a Swede make the description feel a little more natural?',
  },
  {
    id: 'positive',
    start: 112,
    end: 134,
    text: 'Efter det träffade jag',
    category: 'positive',
    label: 'Good usage',
    kind: 'positive',
    hint: 'Notice how the verb moves after “Efter det”.',
    explanation: 'Nice inversion after the introductory phrase “Efter det”. You used the V2 pattern well here.',
    correction: 'Efter det träffade jag',
    rule: 'V2 ✓',
  },
]

function categoryClass(category: Category) {
  return (
    {
      spelling: 'annotation-spelling',
      word_order: 'annotation-order',
      subordinate_clause: 'annotation-grammar',
      noun_gender: 'annotation-grammar',
      adjective_agreement: 'annotation-grammar',
      verb_form: 'annotation-grammar',
      pronoun: 'annotation-grammar',
      reflexive: 'annotation-grammar',
      idiomatic: 'annotation-natural',
      style: 'annotation-natural',
      positive: 'annotation-positive',
    }[category] ?? 'annotation-grammar'
  )
}

function getSelectionOffset(root: HTMLElement, node: Node, offset: number) {
  let total = 0
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (current) =>
      current.parentElement?.closest('sup') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
  })
  while (walker.nextNode()) {
    const current = walker.currentNode
    if (current === node) return total + offset
    total += current.textContent?.length ?? 0
  }
  return total
}

function restoreSelection(root: HTMLElement, start: number, end: number) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let position = 0
  let startNode: Node | null = null
  let endNode: Node | null = null
  let startOffset = 0
  let endOffset = 0
  while (walker.nextNode()) {
    const node = walker.currentNode
    if (node.parentElement?.closest('sup')) {
      continue
    }
    const length = node.textContent?.length ?? 0
    if (!startNode && start <= position + length) {
      startNode = node
      startOffset = start - position
    }
    if (!endNode && end <= position + length) {
      endNode = node
      endOffset = end - position
      break
    }
    position += length
  }
  if (!startNode || !endNode) return
  const selection = window.getSelection()
  if (!selection) return
  const range = document.createRange()
  range.setStart(startNode, Math.max(0, startOffset))
  range.setEnd(endNode, Math.max(0, endOffset))
  selection.removeAllRanges()
  selection.addRange(range)
}

function readEditorText(editor: HTMLElement) {
  const copy = editor.cloneNode(true) as HTMLElement
  copy.querySelectorAll('sup').forEach((marker) => marker.remove())
  return copy.textContent ?? ''
}

function isDev() {
  return process.env.NODE_ENV === 'development'
}

function logClientTiming(label: string, data: Record<string, unknown>) {
  if (isDev()) console.info(`[skriv/latency] ${label}`, data)
}

export function ScrivEditor() {
  const [text, setText] = useState(sampleText)
  const [level, setLevel] = useState('B1')
  const [selected, setSelected] = useState<Annotation | null>(null)
  const [mode, setMode] = useState<'hint' | 'explain' | 'correction'>('hint')
  const [annotations, setAnnotations] = useState(demoAnnotations)
  const [thinking, setThinking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** Bumped only on real user edits / level changes so Strict Mode remounts do not analyze. */
  const [analysisNonce, setAnalysisNonce] = useState(0)
  const requestId = useRef(0)
  const abortRef = useRef<AbortController | null>(null)
  const editorRef = useRef<HTMLDivElement>(null)
  const pendingSelection = useRef<{ start: number; end: number } | null>(null)
  const previousTextRef = useRef(sampleText)
  const analysisRegionRef = useRef(buildAnalysisRegion('', sampleText))
  const lastKeystrokeRef = useRef(0)
  const previousLevelRef = useRef(level)
  const selectedIdRef = useRef<string | null>(null)
  selectedIdRef.current = selected?.id ?? null
  const annotationsRef = useRef(annotations)
  annotationsRef.current = annotations

  // Live analysis — incremental region, debounce, abort + request id.
  useEffect(() => {
    if (analysisNonce === 0) return

    const previousText = previousTextRef.current
    const levelChanged = previousLevelRef.current !== level
    previousLevelRef.current = level

    const caretHint = pendingSelection.current?.start
    const region = levelChanged
      ? {
          text,
          contextBefore: '',
          contextAfter: '',
          documentOffset: 0,
          invalidateStart: 0,
          invalidateEnd: text.length,
          fullDocument: true,
        }
      : buildAnalysisRegion(previousText, text, caretHint)
    analysisRegionRef.current = region

    const preserved = levelChanged
      ? []
      : preserveAnnotationsAfterEdit(
          annotationsRef.current,
          previousText,
          text,
          region.invalidateStart,
          region.invalidateEnd,
        )

    const unchanged =
      preserved.length === annotationsRef.current.length &&
      preserved.every((a, i) => {
        const b = annotationsRef.current[i]
        return b && a.id === b.id && a.start === b.start && a.end === b.end
      })

    if (!unchanged) {
      setAnnotations(preserved)
      annotationsRef.current = preserved
    }

    if (selectedIdRef.current && !preserved.some((a) => a.id === selectedIdRef.current)) {
      setSelected(null)
    }

    previousTextRef.current = text

    const current = ++requestId.current
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    const delay = levelChanged ? 400 : debounceMsForEdit(text, region.text)
    const debounceStarted = performance.now()
    lastKeystrokeRef.current = debounceStarted
    setThinking(true)
    setError(null)

    const analyzedText = text
    const timer = window.setTimeout(async () => {
      const fetchStarted = performance.now()
      logClientTiming('debounce', {
        delayMs: delay,
        waitedMs: Math.round(fetchStarted - debounceStarted),
        regionChars: region.text.length,
        fullDocument: region.fullDocument,
      })

      try {
        const response = await fetch('/api/feedback', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            level,
            text: region.text,
            contextBefore: region.contextBefore,
            contextAfter: region.contextAfter,
            documentOffset: region.documentOffset,
          }),
        })
        const data = await response.json().catch(() => ({}))
        if (current !== requestId.current) return

        const fetchMs = Math.round(performance.now() - fetchStarted)
        const sinceKeystroke = Math.round(performance.now() - lastKeystrokeRef.current)
        logClientTiming('live-response', {
          fetchMs,
          sinceKeystrokeMs: sinceKeystroke,
          serverTiming: data.timing ?? null,
          status: response.status,
        })

        if (!response.ok || typeof data.error === 'string') {
          setError(typeof data.error === 'string' ? data.error : `Feedback request failed (${response.status}).`)
          return
        }

        const incoming = normalizeLiveAnnotations(
          data.annotations,
          region.text,
          typeof data.documentOffset === 'number' ? data.documentOffset : region.documentOffset,
        ).filter((a) => a.end <= analyzedText.length && analyzedText.slice(a.start, a.end) === a.text)

        // Full-document responses replace the set; regional responses merge into preserved marks.
        const merged = region.fullDocument ? incoming : mergeAnnotations(annotationsRef.current, incoming)
        annotationsRef.current = merged
        setAnnotations(merged)
        logClientTiming('annotations-rendered', {
          sinceKeystrokeMs: Math.round(performance.now() - lastKeystrokeRef.current),
          count: merged.length,
        })
      } catch (err) {
        if (controller.signal.aborted) return
        if (current === requestId.current) setError('Could not reach the feedback service.')
        if (isDev()) console.info('[skriv/latency] live-error', err)
      } finally {
        if (current === requestId.current) setThinking(false)
      }
    }, delay)

    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [analysisNonce, text, level])

  // Rebuild annotated DOM when annotations change — preserve caret.
  useEffect(() => {
    const editor = editorRef.current
    if (!editor) return

    const selection = window.getSelection()
    const hasSelection =
      selection &&
      selection.rangeCount > 0 &&
      editor.contains(selection.anchorNode) &&
      editor.contains(selection.focusNode)
    const savedSelection = pendingSelection.current
    const selectionStart =
      savedSelection?.start ??
      (hasSelection ? getSelectionOffset(editor, selection!.anchorNode!, selection!.anchorOffset) : 0)
    const selectionEnd =
      savedSelection?.end ??
      (hasSelection ? getSelectionOffset(editor, selection!.focusNode!, selection!.focusOffset) : 0)

    const valid = annotations
      .filter((a) => a.start >= 0 && a.end <= text.length && a.start < a.end && text.slice(a.start, a.end) === a.text)
      .sort((a, b) => a.start - b.start)

    // Plain text only — do not rebuild DOM (keeps caret stable while typing with no marks).
    if (valid.length === 0) {
      // Ensure no leftover annotation chrome if marks were cleared.
      if (editor.querySelector('[data-annotation]')) {
        const plain = text
        editor.replaceChildren(document.createTextNode(plain))
        if (hasSelection || savedSelection) restoreSelection(editor, selectionStart, selectionEnd)
      }
      pendingSelection.current = null
      return
    }

    let cursor = 0
    editor.replaceChildren()
    for (const annotation of valid) {
      if (annotation.start < cursor) continue
      if (annotation.start > cursor) editor.append(document.createTextNode(text.slice(cursor, annotation.start)))
      const span = document.createElement('span')
      span.dataset.annotation = annotation.id
      span.className = `annotation ${categoryClass(annotation.category)}`
      span.append(document.createTextNode(text.slice(annotation.start, annotation.end)))
      const markerLabel =
        annotation.category === 'positive'
          ? '✓'
          : annotation.category === 'word_order'
            ? 'WO'
            : annotation.category === 'noun_gender'
              ? 'GEN'
              : annotation.category === 'spelling'
                ? 'SP'
                : ''
      if (markerLabel) {
        const marker = document.createElement('sup')
        marker.textContent = markerLabel
        span.append(marker)
      }
      editor.append(span)
      cursor = annotation.end
    }
    if (cursor < text.length) editor.append(document.createTextNode(text.slice(cursor)))
    if (hasSelection || savedSelection) restoreSelection(editor, selectionStart, selectionEnd)
    pendingSelection.current = null
  }, [annotations, text])

  // Seed initial editor content once.
  useEffect(() => {
    const editor = editorRef.current
    if (!editor || editor.childNodes.length > 0) return
    editor.append(document.createTextNode(sampleText))
  }, [])

  function updateText(event: React.FormEvent<HTMLDivElement>) {
    const editor = event.currentTarget
    const selection = window.getSelection()
    if (
      selection &&
      selection.rangeCount > 0 &&
      editorRef.current?.contains(selection.anchorNode) &&
      editorRef.current.contains(selection.focusNode)
    ) {
      pendingSelection.current = {
        start: getSelectionOffset(editorRef.current, selection.anchorNode!, selection.anchorOffset),
        end: getSelectionOffset(editorRef.current, selection.focusNode!, selection.focusOffset),
      }
    }

    // Do NOT strip all annotations here — preservation happens in the text effect.
    // Unwrap only if the browser split annotation nodes awkwardly mid-edit; otherwise
    // leave marks until the analysis effect remaps/invalidates them.
    const next = readEditorText(editor)
    if (next === text) return
    setText(next)
    setAnalysisNonce((n) => n + 1)
  }

  function updateAnnotationDetails(id: string, details: { explanation: string; correction: string; rule: string }) {
    setAnnotations((prev) => {
      const next = prev.map((a) => (a.id === id ? { ...a, ...details } : a))
      annotationsRef.current = next
      return next
    })
    setSelected((prev) => (prev && prev.id === id ? { ...prev, ...details } : prev))
  }

  const patterns = aggregatePatterns(annotations)

  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-7 lg:px-10">
        <div className="flex items-center gap-3">
          <div className="brand-mark">s</div>
          <div>
            <div className="font-serif text-xl leading-none tracking-tight">Skriv</div>
            <div className="mt-1 text-xs text-muted-foreground">AI feedback that helps you learn Swedish</div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <label className="sr-only" htmlFor="level">
            Swedish level
          </label>
          <div className="relative">
            <select
              id="level"
              value={level}
              onChange={(e) => {
                setLevel(e.target.value)
                setAnalysisNonce((n) => n + 1)
              }}
              className="appearance-none rounded-full border border-border bg-card py-2 pl-4 pr-9 text-sm font-medium shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option>A2</option>
              <option>B1</option>
              <option>B2</option>
            </select>
            <ChevronDown aria-hidden="true" className="pointer-events-none absolute right-3 top-2.5 h-4 w-4 text-muted-foreground" />
          </div>
          <button
            aria-label="Open settings"
            className="rounded-full p-2 text-muted-foreground transition hover:bg-muted hover:text-foreground"
          >
            <Settings2 className="h-4 w-4" />
          </button>
        </div>
      </header>

      <section className="mx-auto w-full max-w-5xl px-6 pb-16 pt-12 lg:px-10 lg:pt-20">
        <div className="mx-auto max-w-3xl">
          <div className="mb-7 flex items-center justify-between">
            <div>
              <p className="eyebrow">A quiet place to practice</p>
              <h1 className="mt-2 font-serif text-3xl tracking-tight sm:text-4xl">Write your way there.</h1>
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              {thinking && (
                <>
                  <span className="thinking-dot" /> Thinking…
                </>
              )}
            </div>
          </div>
          {error && (
            <p role="alert" className="mb-4 rounded-xl border border-[#bd6262]/30 bg-[#bd6262]/8 px-4 py-3 text-sm leading-6 text-[#8a3f3f]">
              {error}
            </p>
          )}
          <div className="editor-shell" onClick={() => selected && setSelected(null)}>
            <div
              ref={editorRef}
              contentEditable
              suppressContentEditableWarning
              role="textbox"
              aria-label="Swedish writing editor"
              aria-multiline="true"
              onInput={updateText}
              onClick={(e) => {
                const node = e.target
                const el = node instanceof Element ? node : (node as Node).parentElement
                const target = el?.closest('[data-annotation]') as HTMLElement | null
                const id = target?.dataset.annotation
                if (id) {
                  e.stopPropagation()
                  const found = annotationsRef.current.find((a) => a.id === id)
                  if (found) {
                    setSelected(found)
                    setMode('hint')
                  }
                }
              }}
              onMouseDown={(e) => {
                // Select annotation on mousedown so contentEditable caret placement cannot race-clear it.
                const node = e.target
                const el = node instanceof Element ? node : (node as Node).parentElement
                const target = el?.closest('[data-annotation]') as HTMLElement | null
                const id = target?.dataset.annotation
                if (!id) return
                e.stopPropagation()
                const found = annotationsRef.current.find((a) => a.id === id)
                if (found) {
                  setSelected(found)
                  setMode('hint')
                }
              }}
              className="editor min-h-80 whitespace-pre-wrap text-lg leading-[2.05] outline-none"
              spellCheck={false}
            />
            {selected && (
              <FeedbackPopover
                annotation={selected}
                mode={mode}
                setMode={setMode}
                level={level}
                documentText={text}
                close={() => setSelected(null)}
                onDetailsLoaded={updateAnnotationDetails}
              />
            )}
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">Write naturally. Feedback appears as you pause.</p>
            <p className="text-xs text-muted-foreground">{text.length} characters</p>
          </div>
          <Legend />
          <div className="mt-14 border-t border-border pt-6">
            <div className="flex items-center gap-2">
              <Lightbulb className="h-4 w-4 text-accent-foreground" />
              <h2 className="text-sm font-semibold">Things to notice</h2>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {patterns.length === 0 ? (
                <span className="text-xs text-muted-foreground">Patterns will appear as feedback arrives.</span>
              ) : (
                patterns.map((item) => (
                  <button
                    key={item.category}
                    type="button"
                    className="rounded-full border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground transition hover:border-foreground/30 hover:text-foreground"
                  >
                    {item.label} · {item.count}
                  </button>
                ))
              )}
            </div>
            <p className="mt-5 max-w-xl text-sm leading-6 text-muted-foreground">{patternsSummarySentence(patterns)}</p>
          </div>
        </div>
      </section>
    </main>
  )
}

function Legend() {
  const items = [
    ['annotation-spelling', 'Spelling'],
    ['annotation-grammar', 'Grammar'],
    ['annotation-order', 'Word order'],
    ['annotation-natural', 'Natural Swedish'],
    ['annotation-positive', 'Good usage'],
  ]
  return (
    <div className="mt-10 flex flex-wrap gap-x-5 gap-y-2 border-t border-border/70 pt-4">
      {items.map(([className, label]) => (
        <div key={label} className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className={`legend-mark ${className}`} />
          {label}
        </div>
      ))}
    </div>
  )
}

function FeedbackPopover({
  annotation,
  mode,
  setMode,
  level,
  documentText,
  close,
  onDetailsLoaded,
}: {
  annotation: Annotation
  mode: 'hint' | 'explain' | 'correction'
  setMode: (mode: 'hint' | 'explain' | 'correction') => void
  level: string
  documentText: string
  close: () => void
  onDetailsLoaded: (id: string, details: { explanation: string; correction: string; rule: string }) => void
}) {
  const [loading, setLoading] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const hasDetails = Boolean(annotation.explanation && annotation.correction)

  async function ensureDetails() {
    if (hasDetails || loading) return
    setLoading(true)
    setDetailError(null)
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    const spans = findSentenceSpans(documentText)
    const idx = sentenceIndexAt(spans, annotation.start)
    const sentence = idx >= 0 ? spans[idx]! : { start: annotation.start, end: annotation.end, text: annotation.text }
    const contextBefore = idx > 0 ? spans[idx - 1]!.text.trim() : ''
    const contextAfter = idx >= 0 && idx < spans.length - 1 ? spans[idx + 1]!.text.trim() : ''

    const started = performance.now()
    try {
      const response = await fetch('/api/feedback/details', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          level,
          category: annotation.category,
          label: annotation.label,
          kind: annotation.kind,
          hint: annotation.hint,
          span: annotation.text,
          sentence: sentence.text.trim(),
          contextBefore,
          contextAfter,
        }),
      })
      const data = await response.json().catch(() => ({}))
      if (controller.signal.aborted) return
      logClientTiming('deep-details', {
        fetchMs: Math.round(performance.now() - started),
        serverTiming: data.timing ?? null,
        status: response.status,
      })
      if (!response.ok || typeof data.error === 'string') {
        setDetailError(typeof data.error === 'string' ? data.error : 'Could not load explanation.')
        return
      }
      onDetailsLoaded(annotation.id, {
        explanation: String(data.explanation ?? ''),
        correction: String(data.correction ?? ''),
        rule: String(data.rule ?? 'Swedish usage'),
      })
    } catch (err) {
      if (controller.signal.aborted) return
      setDetailError('Could not load explanation.')
      if (isDev()) console.info('[skriv/latency] deep-error', err)
    } finally {
      if (!controller.signal.aborted) setLoading(false)
    }
  }

  useEffect(() => () => abortRef.current?.abort(), [])

  async function requestMode(next: 'hint' | 'explain' | 'correction') {
    if (next === 'hint') {
      setMode('hint')
      return
    }
    setMode(next)
    if (!hasDetails) await ensureDetails()
  }

  const body =
    mode === 'explain' ? (
      loading && !annotation.explanation ? (
        <span className="text-muted-foreground">Loading explanation…</span>
      ) : (
        annotation.explanation || (detailError ? null : annotation.hint)
      )
    ) : mode === 'correction' ? (
      loading && !annotation.correction ? (
        <span className="text-muted-foreground">Loading correction…</span>
      ) : annotation.correction ? (
        <>
          <span className="text-muted-foreground">Try: </span>
          <strong>{annotation.correction}</strong>
        </>
      ) : detailError ? null : (
        annotation.hint
      )
    ) : (
      annotation.hint
    )

  return (
    <aside
      className="feedback-popover"
      role="dialog"
      aria-label={`${annotation.label} feedback`}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">{annotation.label}</div>
          <div className="mt-2 font-serif text-lg">{annotation.text}</div>
        </div>
        <button aria-label="Close feedback" onClick={close} className="text-muted-foreground hover:text-foreground">
          <X className="h-4 w-4" />
        </button>
      </div>
      {annotation.kind === 'positive' || annotation.category === 'positive' ? (
        <p className="mt-4 text-sm leading-6 text-foreground/75">
          {annotation.explanation || annotation.hint}
          {!annotation.explanation && (
            <button
              type="button"
              className="ml-2 text-xs text-muted-foreground underline"
              onClick={() => void ensureDetails()}
            >
              {loading ? 'Loading…' : 'More'}
            </button>
          )}
        </p>
      ) : (
        <>
          <p className="mt-4 text-sm leading-6 text-foreground/75">{body}</p>
          {detailError && mode !== 'hint' && (
            <p className="mt-2 text-xs text-[#8a3f3f]">{detailError}</p>
          )}
          <div className="mt-5 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void requestMode(mode === 'explain' ? 'hint' : 'explain')}
              className={`popover-button ${mode === 'explain' ? 'active' : ''}`}
            >
              Explain
            </button>
            <button
              type="button"
              onClick={() => void requestMode(mode === 'correction' ? 'hint' : 'correction')}
              className={`popover-button ${mode === 'correction' ? 'active' : ''}`}
            >
              Show correction
            </button>
          </div>
        </>
      )}
      <div className="mt-4 flex items-center gap-2 text-[11px] text-muted-foreground">
        <Sparkles className="h-3 w-3" /> {annotation.rule || 'Swedish usage'}
      </div>
    </aside>
  )
}
