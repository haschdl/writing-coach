export type Category =
  | 'spelling'
  | 'word_order'
  | 'subordinate_clause'
  | 'noun_gender'
  | 'adjective_agreement'
  | 'verb_form'
  | 'pronoun'
  | 'reflexive'
  | 'idiomatic'
  | 'style'
  | 'positive'

export type AnnotationKind = 'error' | 'naturalness' | 'positive'

export type Annotation = {
  id: string
  start: number
  end: number
  text: string
  category: Category
  label: string
  kind: AnnotationKind
  hint: string
  confidence?: number
  /** Lazily loaded deep feedback */
  explanation?: string
  correction?: string
  rule?: string
}

export type LiveFeedbackRequest = {
  level: string
  text: string
  contextBefore?: string
  contextAfter?: string
  documentOffset: number
}

export type LiveFeedbackResponse = {
  annotations: Annotation[]
  timing?: {
    modelMs: number
    totalMs: number
  }
}

export type DeepFeedbackRequest = {
  level: string
  category: string
  label: string
  kind: string
  hint: string
  span: string
  sentence: string
  contextBefore?: string
  contextAfter?: string
}

export type DeepFeedbackResponse = {
  explanation: string
  correction: string
  rule: string
  timing?: {
    modelMs: number
    totalMs: number
  }
}

export type PatternSummary = {
  category: string
  label: string
  count: number
}
