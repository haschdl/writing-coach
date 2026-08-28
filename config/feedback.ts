export const feedbackSystemPrompt = 'Return semantic annotations only. Never return HTML.'

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

export function buildFeedbackPrompt(text: string, level: unknown) {
  const learnerLevel = typeof level === 'string' && level.trim().length > 0 ? level.trim() : 'B1'
  return `You are a kind Swedish tutor. Review this ${learnerLevel} learner writing. Return only JSON matching the schema. Identify at most 6 high-value, smallest-span learning opportunities. Distinguish incorrect Swedish from understandable but unnatural phrasing. Do not flag valid learner Swedish just to make it native. Use English explanations. Categories: ${feedbackCategories.join(', ')}. Give hints before answers. Text: ${text}`
}
