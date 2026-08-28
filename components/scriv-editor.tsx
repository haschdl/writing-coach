'use client'

import { useEffect, useRef, useState } from 'react'
import { ChevronDown, Lightbulb, Settings2, Sparkles, X } from 'lucide-react'

type Category = 'spelling' | 'word_order' | 'subordinate_clause' | 'noun_gender' | 'adjective_agreement' | 'verb_form' | 'pronoun' | 'reflexive' | 'idiomatic' | 'style' | 'positive'
type Annotation = { id: string; start: number; end: number; text: string; category: Category; label: string; hint: string; explanation: string; correction: string; rule: string }

const sampleText = 'Igår jag gick till affären eftersom jag hade inte någon mjölk hemma. Jag köpte ett banan och några andra saker. Efter det träffade jag min kompis och vi pratade om jobbet. Det var en mycket rolig kväll.'

const demoAnnotations: Annotation[] = [
  { id: 'v2', start: 0, end: 13, text: 'Igår jag gick', category: 'word_order', label: 'Word order', hint: 'The sentence starts with a time expression. What normally comes immediately after it in a Swedish main clause?', explanation: 'Swedish main clauses follow the V2 rule. When another element such as “igår” comes first, the finite verb normally comes second.', correction: 'Igår gick jag', rule: 'V2 rule' },
  { id: 'sub', start: 49, end: 58, text: 'hade inte', category: 'subordinate_clause', label: 'Subordinate clause', hint: 'Look at the word order after “eftersom”. Does this clause follow the same pattern as a main clause?', explanation: 'In an “eftersom” clause, the sentence adverb “inte” normally comes before the finite verb: eftersom jag inte hade…', correction: 'eftersom jag inte hade någon mjölk hemma', rule: 'Subordinate clause' },
  { id: 'gender', start: 86, end: 95, text: 'ett banan', category: 'noun_gender', label: 'Noun gender', hint: 'Which article usually goes with “banan”? Try saying the noun with both “en” and “ett”.', explanation: '“Banan” is an en-word, so the indefinite article is “en”.', correction: 'en banan', rule: 'En / ett' },
  { id: 'natural', start: 190, end: 207, text: 'en mycket rolig', category: 'idiomatic', label: 'Natural Swedish', hint: 'This is understandable. How might a Swede make the description feel a little more natural?', explanation: 'This phrase is understandable and not a serious error. Swedish often puts “väldigt” before an adjective in this kind of sentence.', correction: 'en väldigt rolig', rule: 'Natural phrasing' },
  { id: 'positive', start: 128, end: 160, text: 'Efter det träffade jag', category: 'positive', label: 'Good usage', hint: 'Notice how the verb moves after “Efter det”.', explanation: 'Nice inversion after the introductory phrase “Efter det”. You used the V2 pattern well here.', correction: 'Efter det träffade jag', rule: 'V2 ✓' },
]

function categoryClass(category: Category) {
  return {
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
}

function getSelectionOffset(root: HTMLElement, node: Node, offset: number) {
  let total = 0
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (current) => current.parentElement?.closest('sup') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
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
    const length = node.textContent?.length ?? 0
    if (!startNode && start <= position + length) { startNode = node; startOffset = start - position }
    if (!endNode && end <= position + length) { endNode = node; endOffset = end - position; break }
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

function normalizeAnnotations(value: unknown, sourceText: string): Annotation[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item, index) => {
    if (!item || typeof item !== 'object') return []
    const candidate = item as Partial<Annotation>
    const start = Number(candidate.start)
    const end = Number(candidate.end)
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > sourceText.length) return []
    const reportedText = typeof candidate.text === 'string' ? candidate.text : ''
    const exactText = reportedText && sourceText.slice(start, end) !== reportedText
      ? sourceText.indexOf(reportedText)
      : start
    const resolvedStart = exactText >= 0 ? exactText : start
    const resolvedEnd = resolvedStart + (reportedText ? reportedText.length : end - start)
    if (resolvedEnd > sourceText.length || resolvedEnd <= resolvedStart) return []
    const text = sourceText.slice(resolvedStart, resolvedEnd)
    return [{
      id: typeof candidate.id === 'string' ? candidate.id : `annotation-${index}`,
      start: resolvedStart, end: resolvedEnd, text,
      category: typeof candidate.category === 'string' ? candidate.category as Category : 'style',
      label: typeof candidate.label === 'string' ? candidate.label : 'Feedback',
      hint: typeof candidate.hint === 'string' ? candidate.hint : '',
      explanation: typeof candidate.explanation === 'string' ? candidate.explanation : '',
      correction: typeof candidate.correction === 'string' ? candidate.correction : '',
      rule: typeof candidate.rule === 'string' ? candidate.rule : 'Swedish usage',
    }]
  })
}

export function ScrivEditor() {
  const [text, setText] = useState(sampleText)
  const [level, setLevel] = useState('B1')
  const [selected, setSelected] = useState<Annotation | null>(null)
  const [mode, setMode] = useState<'notice' | 'hint' | 'explain' | 'correction'>('notice')
  const [annotations, setAnnotations] = useState(demoAnnotations)
  const [thinking, setThinking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const requestId = useRef(0)
  const editorRef = useRef<HTMLDivElement>(null)
  const pendingSelection = useRef<{ start: number; end: number } | null>(null)

  useEffect(() => {
    const current = ++requestId.current
    setThinking(true)
    setError(null)
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch('/api/feedback', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, level }) })
        const data = await response.json().catch(() => ({}))
        if (current !== requestId.current) return
        if (!response.ok || typeof data.error === 'string') {
          setError(typeof data.error === 'string' ? data.error : `Feedback request failed (${response.status}).`)
          return
        }
        setAnnotations(normalizeAnnotations(data.annotations, text))
      } catch {
        if (current === requestId.current) setError('Could not reach the feedback service.')
      } finally {
        if (current === requestId.current) setThinking(false)
      }
    }, 1200)
    return () => window.clearTimeout(timer)
  }, [text, level])

  useEffect(() => {
    const editor = editorRef.current
    if (!editor) return

    const selection = window.getSelection()
    const hasSelection = selection && selection.rangeCount > 0 && editor.contains(selection.anchorNode) && editor.contains(selection.focusNode)
    const savedSelection = pendingSelection.current
    const selectionStart = savedSelection?.start ?? (hasSelection ? getSelectionOffset(editor, selection.anchorNode!, selection.anchorOffset) : 0)
    const selectionEnd = savedSelection?.end ?? (hasSelection ? getSelectionOffset(editor, selection.focusNode!, selection.focusOffset) : 0)
    const valid = annotations
      .filter((a) => a.start >= 0 && a.end <= text.length && a.start < a.end)
      .sort((a, b) => a.start - b.start)
    // An empty response means “no feedback”; do not rebuild the editable DOM.
    if (valid.length === 0) {
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
      const marker = document.createElement('sup')
      marker.textContent = annotation.category === 'positive' ? '✓' : annotation.category === 'word_order' ? 'WO' : annotation.category === 'noun_gender' ? 'GEN' : ''
      span.append(marker)
      editor.append(span)
      cursor = annotation.end
    }
    if (cursor < text.length) editor.append(document.createTextNode(text.slice(cursor)))
    if (hasSelection || savedSelection) restoreSelection(editor, selectionStart, selectionEnd)
    pendingSelection.current = null
  }, [annotations])

  function updateText(event: React.FormEvent<HTMLDivElement>) {
    // Remove demo/previous feedback immediately without replacing the editable root.
    event.currentTarget.querySelectorAll('sup').forEach((marker) => marker.remove())
    event.currentTarget.querySelectorAll('[data-annotation]').forEach((span) => {
      const parent = span.parentNode
      while (span.firstChild) parent?.insertBefore(span.firstChild, span)
      parent?.removeChild(span)
    })
    setAnnotations([])
    const selection = window.getSelection()
    if (selection && selection.rangeCount > 0 && editorRef.current?.contains(selection.anchorNode) && editorRef.current.contains(selection.focusNode)) {
      pendingSelection.current = {
        start: getSelectionOffset(editorRef.current, selection.anchorNode!, selection.anchorOffset),
        end: getSelectionOffset(editorRef.current, selection.focusNode!, selection.focusOffset),
      }
    }
    const copy = event.currentTarget.cloneNode(true) as HTMLElement
    copy.querySelectorAll('sup').forEach((marker) => marker.remove())
    setText(copy.textContent ?? '')
    setSelected(null)
  }

  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-7 lg:px-10">
        <div className="flex items-center gap-3"><div className="brand-mark">s</div><div><div className="font-serif text-xl leading-none tracking-tight">Skriv</div><div className="mt-1 text-xs text-muted-foreground">AI feedback that helps you learn Swedish</div></div></div>
        <div className="flex items-center gap-3"><label className="sr-only" htmlFor="level">Swedish level</label><div className="relative"><select id="level" value={level} onChange={(e) => setLevel(e.target.value)} className="appearance-none rounded-full border border-border bg-card py-2 pl-4 pr-9 text-sm font-medium shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"><option>A2</option><option>B1</option><option>B2</option></select><ChevronDown aria-hidden="true" className="pointer-events-none absolute right-3 top-2.5 h-4 w-4 text-muted-foreground" /></div><button aria-label="Open settings" className="rounded-full p-2 text-muted-foreground transition hover:bg-muted hover:text-foreground"><Settings2 className="h-4 w-4" /></button></div>
      </header>

      <section className="mx-auto w-full max-w-5xl px-6 pb-16 pt-12 lg:px-10 lg:pt-20">
        <div className="mx-auto max-w-3xl"><div className="mb-7 flex items-center justify-between"><div><p className="eyebrow">A quiet place to practice</p><h1 className="mt-2 font-serif text-3xl tracking-tight sm:text-4xl">Write your way there.</h1></div><div className="flex items-center gap-2 text-xs text-muted-foreground">{thinking && <><span className="thinking-dot" /> Thinking…</>}</div></div>
          {error && <p role="alert" className="mb-4 rounded-xl border border-[#bd6262]/30 bg-[#bd6262]/8 px-4 py-3 text-sm leading-6 text-[#8a3f3f]">{error}</p>}
          <div className="editor-shell" onClick={() => selected && setSelected(null)}><div ref={editorRef} contentEditable suppressContentEditableWarning role="textbox" aria-label="Swedish writing editor" aria-multiline="true" onInput={updateText} onClick={(e) => { const target = e.target as HTMLElement; const id = target.dataset.annotation; if (id) { e.stopPropagation(); const found = annotations.find((a) => a.id === id); if (found) { setSelected(found); setMode('notice') } } }} className="editor min-h-80 whitespace-pre-wrap text-lg leading-[2.05] outline-none" spellCheck="false"></div>{selected && <FeedbackPopover annotation={selected} mode={mode} setMode={setMode} close={() => setSelected(null)} />}</div>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3"><p className="text-xs text-muted-foreground">Write naturally. Feedback appears as you pause.</p><p className="text-xs text-muted-foreground">{text.length} characters</p></div>
          <Legend />
          <div className="mt-14 border-t border-border pt-6"><div className="flex items-center gap-2"><Lightbulb className="h-4 w-4 text-accent-foreground" /><h2 className="text-sm font-semibold">Things to notice</h2></div><div className="mt-4 flex flex-wrap gap-2">{['Word order · 2', 'Noun gender · 1', 'Natural phrasing · 2'].map((item) => <button key={item} className="rounded-full border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground transition hover:border-foreground/30 hover:text-foreground">{item}</button>)}</div><p className="mt-5 max-w-xl text-sm leading-6 text-muted-foreground">A few sentences have word order worth reviewing. See if you can spot the pattern before asking for a hint.</p></div>
        </div>
      </section>
    </main>
  )
}

function Legend() { const items = [['annotation-spelling', 'Spelling'], ['annotation-grammar', 'Grammar'], ['annotation-order', 'Word order'], ['annotation-natural', 'Natural Swedish'], ['annotation-positive', 'Good usage']]; return <div className="mt-10 flex flex-wrap gap-x-5 gap-y-2 border-t border-border/70 pt-4">{items.map(([className, label]) => <div key={label} className="flex items-center gap-2 text-xs text-muted-foreground"><span className={`legend-mark ${className}`} />{label}</div>)}</div> }

function FeedbackPopover({ annotation, mode, setMode, close }: { annotation: Annotation; mode: 'notice' | 'hint' | 'explain' | 'correction'; setMode: (mode: 'notice' | 'hint' | 'explain' | 'correction') => void; close: () => void }) { return <aside className="feedback-popover" role="dialog" aria-label={`${annotation.label} feedback`} onClick={(e) => e.stopPropagation()}><div className="flex items-start justify-between gap-4"><div><div className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">{annotation.label}</div><div className="mt-2 font-serif text-lg">{annotation.text}</div></div><button aria-label="Close feedback" onClick={close} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button></div>{mode !== 'notice' && <p className="mt-4 text-sm leading-6 text-foreground/75">{mode === 'hint' ? annotation.hint : mode === 'explain' ? annotation.explanation : <><span className="text-muted-foreground">Try: </span><strong>{annotation.correction}</strong></>}</p>}{annotation.category === 'positive' ? <p className="mt-4 text-sm leading-6 text-foreground/75">{annotation.explanation}</p> : <div className="mt-5 flex flex-wrap gap-2"><button onClick={() => setMode('hint')} className={`popover-button ${mode === 'hint' ? 'active' : ''}`}>Hint</button><button onClick={() => setMode('explain')} className={`popover-button ${mode === 'explain' ? 'active' : ''}`}>Explain</button><button onClick={() => setMode('correction')} className={`popover-button ${mode === 'correction' ? 'active' : ''}`}>Show correction</button></div>}<div className="mt-4 flex items-center gap-2 text-[11px] text-muted-foreground"><Sparkles className="h-3 w-3" /> {annotation.rule}</div></aside> }
