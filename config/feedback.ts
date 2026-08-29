export const feedbackCategories = [
  'spelling',
  'noun_gender',
  'adjective_agreement',
  'verb_form',
  'word_order',
  'subordinate_clause',
  'pronoun',
  'reflexive',
  'idiomatic',
  'style',
  'positive',
] as const

export type FeedbackCategory = (typeof feedbackCategories)[number]

export const annotationKinds = ['error', 'naturalness', 'positive'] as const
export type AnnotationKind = (typeof annotationKinds)[number]

/** Stable system instructions for live analysis (keep separate from learner text). */
export const liveFeedbackSystemPrompt = `You are a Swedish language tutor for A2–B2 learners.

Your job during live typing is NOT to rewrite the text.

Return only a few high-confidence, high-value learning opportunities (at most 4).

Priorities include:
- V2 word order
- huvudsats vs bisats
- inte placement
- en/ett
- adjective agreement
- verb forms
- reflexives
- pronouns
- common prepositions
- strongly unnatural but understandable phrasing

Distinguish:
1. objectively incorrect Swedish (kind: "error")
2. understandable but unnatural Swedish (kind: "naturalness")
3. stylistic alternatives (kind: "naturalness" or "style" category)
4. correct noteworthy Swedish (kind: "positive") — use sparingly

Do NOT mark valid learner Swedish as wrong simply because a native speaker might phrase it differently.
Avoid low-confidence annotations.
Prefer the smallest meaningful span.
Hints should invite the learner to think rather than reveal the answer.
Hints should normally be one short sentence.
Use English for UI feedback.
Return semantic data only, never HTML.
Offsets (start/end) are 0-based character indices into the analyzed text field only (not contextBefore/contextAfter).`

export const deepFeedbackSystemPrompt = `You are a Swedish language tutor for A2–B2 learners.

The learner clicked for a deeper explanation of one annotation.
Give a concise English explanation and a corrected Swedish span or phrase.
Do not rewrite the whole text.
Do not invent unrelated issues.
Return semantic data only, never HTML.`

export function buildLiveFeedbackUserPrompt(input: {
  level: string
  text: string
  contextBefore?: string
  contextAfter?: string
}) {
  const parts = [
    `Learner level: ${input.level}`,
    `Analyze this Swedish text (offsets relative to this field only):`,
    input.text,
  ]
  if (input.contextBefore?.trim()) {
    parts.push(`Context before (do not annotate): ${input.contextBefore}`)
  }
  if (input.contextAfter?.trim()) {
    parts.push(`Context after (do not annotate): ${input.contextAfter}`)
  }
  parts.push(
    `Categories: ${feedbackCategories.join(', ')}.`,
    `Return at most 4 annotations. Precision over recall.`,
  )
  return parts.join('\n\n')
}

export function buildDeepFeedbackUserPrompt(input: {
  level: string
  category: string
  label: string
  kind: string
  hint: string
  span: string
  sentence: string
  contextBefore?: string
  contextAfter?: string
}) {
  return [
    `Learner level: ${input.level}`,
    `Category: ${input.category}`,
    `Label: ${input.label}`,
    `Kind: ${input.kind}`,
    `Annotated span: ${input.span}`,
    `Hint already shown: ${input.hint}`,
    `Relevant sentence: ${input.sentence}`,
    input.contextBefore?.trim() ? `Context before: ${input.contextBefore}` : null,
    input.contextAfter?.trim() ? `Context after: ${input.contextAfter}` : null,
    `Provide explanation, correction, and a short rule name.`,
  ]
    .filter(Boolean)
    .join('\n')
}

/** Compact live-analysis schema — no explanation/correction/rule. */
export const liveFeedbackSchema = {
  type: 'object',
  properties: {
    annotations: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          start: { type: 'integer' },
          end: { type: 'integer' },
          text: { type: 'string' },
          category: { type: 'string', enum: [...feedbackCategories] },
          label: { type: 'string' },
          kind: { type: 'string', enum: [...annotationKinds] },
          hint: { type: 'string' },
        },
        required: ['id', 'start', 'end', 'text', 'category', 'label', 'kind', 'hint'],
        additionalProperties: false,
      },
    },
  },
  required: ['annotations'],
  additionalProperties: false,
} as const

export const deepFeedbackSchema = {
  type: 'object',
  properties: {
    explanation: { type: 'string' },
    correction: { type: 'string' },
    rule: { type: 'string' },
  },
  required: ['explanation', 'correction', 'rule'],
  additionalProperties: false,
} as const

/** @deprecated Prefer liveFeedbackSystemPrompt — kept for any residual imports. */
export const feedbackSystemPrompt = liveFeedbackSystemPrompt

/** @deprecated Prefer buildLiveFeedbackUserPrompt */
export function buildFeedbackPrompt(text: string, level: unknown) {
  const learnerLevel = typeof level === 'string' && level.trim().length > 0 ? level.trim() : 'B1'
  return buildLiveFeedbackUserPrompt({ level: learnerLevel, text })
}
