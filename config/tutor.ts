import type { CEFRLevel, TutorMessage, TutorSelection } from '@/lib/tutor-types'

export const TUTOR_MAX_MESSAGE_CHARS = 2000
export const TUTOR_MAX_DOCUMENT_CHARS = 8000
export const TUTOR_MAX_HISTORY_MESSAGES = 40
export const TUTOR_MAX_HISTORY_CHARS = 24000

export function tutorSystemPrompt(level: CEFRLevel) {
  return `You are a knowledgeable Swedish language tutor helping a learner at CEFR level ${level}.

Explain in clear English. Use Swedish examples in your answers.

The learner is writing Swedish compositions. You may receive their current draft as contextual state (not as a chat message). When document context is provided:
- Treat it as their current work-in-progress; it may contain errors or be incomplete.
- Use it only when relevant to the question — do not critique the whole draft unless asked.
- If they ask "what word can I use here?" or similar, relate your answer to the draft when helpful.
- If they ask a general Swedish question unrelated to the draft, answer that directly.

When selected text or a cursor position is provided, prioritize that span for "here" questions.

Pedagogy:
- Help the learner produce language themselves; do not take over their writing.
- Explain why when useful; offer options and contrast meanings.
- Give concise Swedish examples.
- Avoid rewriting the entire draft unless explicitly asked (e.g. "rewrite this sentence").
- For word-choice questions, address the specific lexical problem.
- Keep answers focused; do not turn every reply into a long lesson unless asked.

At ${level}:
${levelGuidance(level)}

You may discuss vocabulary, synonyms, idioms, grammar, word order, verb forms, noun gender, prepositions, register, natural phrasing, and how to express ideas in Swedish.

Format replies with short paragraphs. Use **bold** and *italics* sparingly. Bullet lists are fine when comparing options.`
}

function levelGuidance(level: CEFRLevel) {
  switch (level) {
    case 'A2':
      return '- Use simple, concrete explanations.\n- Avoid heavy linguistic jargon.\n- Prefer everyday examples.'
    case 'B1':
      return '- Keep explanations clear.\n- Introduce useful terms like V2 or bisats when helpful, but explain them in plain English.\n- Avoid unnecessarily advanced linguistic language.'
    case 'B2':
      return '- You can use more precise grammatical terminology when it helps.\n- Discuss nuance, register, and idiomatic choices in more depth.'
  }
}

export function buildDocumentContextBlock(options: {
  document: string
  cursorOffset?: number
  selection?: TutorSelection
}) {
  const parts: string[] = ['## Current learner draft (context only — not a chat message)']

  if (options.selection?.text) {
    parts.push(
      `Selected text (offsets ${options.selection.start}–${options.selection.end}): "${options.selection.text}"`,
    )
  } else if (typeof options.cursorOffset === 'number') {
    parts.push(`Cursor position: character offset ${options.cursorOffset}`)
  }

  const doc = options.document.trim()
  if (doc) {
    parts.push('Full draft:\n"""')
    parts.push(doc)
    parts.push('"""')
  } else {
    parts.push('The draft is currently empty.')
  }

  parts.push(
    'Use this context when relevant. Do not assume the learner wants feedback on the entire draft.',
  )

  return parts.join('\n\n')
}

export function buildTutorInput(options: {
  level: CEFRLevel
  message: string
  document: string
  useDocument: boolean
  cursorOffset?: number
  selection?: TutorSelection
  messages: TutorMessage[]
}) {
  const input: Array<{ role: 'user' | 'assistant' | 'developer'; content: string }> = []

  for (const item of options.messages) {
    input.push({ role: item.role, content: item.content })
  }

  if (options.useDocument) {
    input.push({
      role: 'developer',
      content: buildDocumentContextBlock({
        document: options.document,
        cursorOffset: options.cursorOffset,
        selection: options.selection,
      }),
    })
  }

  input.push({ role: 'user', content: options.message })

  return input
}

export function capDocumentContext(document: string) {
  if (document.length <= TUTOR_MAX_DOCUMENT_CHARS) return document
  return document.slice(0, TUTOR_MAX_DOCUMENT_CHARS)
}
