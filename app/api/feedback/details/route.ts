import { NextResponse } from 'next/server'

import {
  buildDeepFeedbackUserPrompt,
  deepFeedbackSchema,
  deepFeedbackSystemPrompt,
} from '@/config/feedback'
import { DEEP_FEEDBACK_MODEL, DEEP_FEEDBACK_REASONING_EFFORT } from '@/config/models'
import { createStructuredResponse, isAbortError, MissingApiKeyError } from '@/lib/openai'

type DeepBody = {
  level?: unknown
  category?: unknown
  label?: unknown
  kind?: unknown
  hint?: unknown
  span?: unknown
  sentence?: unknown
  contextBefore?: unknown
  contextAfter?: unknown
}

function fail(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

function asString(value: unknown, fallback = '') {
  return typeof value === 'string' ? value : fallback
}

export async function POST(request: Request) {
  const totalStarted = performance.now()
  let body: DeepBody
  try {
    body = await request.json()
  } catch {
    return fail('Request body must be JSON.', 400)
  }

  const span = asString(body.span)
  const sentence = asString(body.sentence)
  if (!span || !sentence || span.length > 500 || sentence.length > 2000) {
    return fail('Invalid annotation detail request.', 400)
  }

  const level = asString(body.level, 'B1').trim() || 'B1'

  try {
    const { data, modelMs } = await createStructuredResponse<{
      explanation: string
      correction: string
      rule: string
    }>({
      model: DEEP_FEEDBACK_MODEL,
      reasoningEffort: DEEP_FEEDBACK_REASONING_EFFORT,
      system: deepFeedbackSystemPrompt,
      user: buildDeepFeedbackUserPrompt({
        level,
        category: asString(body.category, 'style'),
        label: asString(body.label, 'Feedback'),
        kind: asString(body.kind, 'error'),
        hint: asString(body.hint),
        span,
        sentence,
        contextBefore: asString(body.contextBefore),
        contextAfter: asString(body.contextAfter),
      }),
      schemaName: 'swedish_annotation_details',
      schema: deepFeedbackSchema as unknown as Record<string, unknown>,
      signal: request.signal,
    })

    const totalMs = Math.round(performance.now() - totalStarted)
    const response = NextResponse.json({
      explanation: data.explanation,
      correction: data.correction,
      rule: data.rule,
      timing: { modelMs, totalMs },
    })
    response.headers.set('Server-Timing', `model;dur=${modelMs}, total;dur=${totalMs}`)
    if (process.env.NODE_ENV === 'development') {
      console.info('[feedback/details]', { model: DEEP_FEEDBACK_MODEL, modelMs, totalMs })
    }
    return response
  } catch (error) {
    if (isAbortError(error)) {
      return fail('Aborted.', 499)
    }
    if (error instanceof MissingApiKeyError) {
      return fail(error.message, 503)
    }
    const message = error instanceof Error ? error.message : 'Detail request failed.'
    return fail(message, 502)
  }
}
