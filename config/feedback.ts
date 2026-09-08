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

export const feedbackVerdicts = ['change_required', 'optional_alternative', 'correct'] as const
export type FeedbackVerdict = (typeof feedbackVerdicts)[number]

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

For every annotation, first decide the verdict:
- "change_required": the Swedish is objectively incorrect and the learner should change the annotated span. Pair with kind: "error".
- "optional_alternative": the Swedish is understandable/valid but a clearly more natural Swedish alternative is worth teaching. Pair with kind: "naturalness".
- "correct": the annotated span should stay exactly as written. Pair with kind: "positive" and category: "positive". Use this sparingly for genuinely useful positive reinforcement.

The verdict is the source of truth. Never return a contradictory combination of verdict, kind, category, and hint.
If the wording should remain unchanged, NEVER use "change_required" or "optional_alternative".
If the sentence is correct but not especially noteworthy, return no annotation at all rather than inventing a comparison with another valid word or construction.
Do not annotate correct wording merely to explain why another word (for example när instead of om) would change the meaning.

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
Re-evaluate the annotation rather than assuming the live analysis was correct.

Return one verdict:
- "change_required": the annotated Swedish is objectively incorrect and should be changed.
- "optional_alternative": the annotated Swedish is valid/understandable, but a clearly more natural alternative is worth showing.
- "correct": the annotated Swedish should remain exactly as written; use this when the live annotation was a false positive or when it is positive feedback.

If verdict is "correct", correction MUST be exactly the annotated span with no arrows, commentary, Markdown, or “(correct)” suffix.
If verdict is "change_required" or "optional_alternative", correction should be the replacement Swedish span only and should normally differ from the annotated span.
Give a concise English explanation and a short rule name.
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
    `Verdicts: ${feedbackVerdicts.join(', ')}.`,
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
    `Kind from live analysis: ${input.kind}`,
    `Annotated span: ${input.span}`,
    `Hint already shown: ${input.hint}`,
    `Relevant sentence: ${input.sentence}`,
    input.contextBefore?.trim() ? `Context before: ${input.contextBefore}` : null,
    input.contextAfter?.trim() ? `Context after: ${input.contextAfter}` : null,
    `Re-evaluate the annotation and provide verdict, explanation, correction, and a short rule name.`,
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
          verdict: { type: 'string', enum: [...feedbackVerdicts] },
          hint: { type: 'string' },
        },
        required: ['id', 'start', 'end', 'text', 'category', 'label', 'kind', 'verdict', 'hint'],
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
    verdict: { type: 'string', enum: [...feedbackVerdicts] },
    explanation: { type: 'string' },
    correction: { type: 'string' },
    rule: { type: 'string' },
  },
  required: ['verdict', 'explanation', 'correction', 'rule'],
  additionalProperties: false,
} as const

/** @deprecated Prefer liveFeedbackSystemPrompt — kept for any residual imports. */
export const feedbackSystemPrompt = liveFeedbackSystemPrompt

/** @deprecated Prefer buildLiveFeedbackUserPrompt */
export function buildFeedbackPrompt(text: string, level: unknown) {
  const learnerLevel = typeof level === 'string' && level.trim().length > 0 ? level.trim() : 'B1'
  return buildLiveFeedbackUserPrompt({ level: learnerLevel, text })
}
