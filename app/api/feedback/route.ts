import { NextResponse } from 'next/server'

import {
  buildLiveFeedbackUserPrompt,
  liveFeedbackSchema,
  liveFeedbackSystemPrompt,
} from '@/config/feedback'
import { LIVE_FEEDBACK_MODEL, LIVE_FEEDBACK_REASONING_EFFORT } from '@/config/models'
import { createStructuredResponse, isAbortError, MissingApiKeyError } from '@/lib/openai'

type LiveBody = {
  text?: unknown
  level?: unknown
  contextBefore?: unknown
  contextAfter?: unknown
  documentOffset?: unknown
}

function fail(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

export async function POST(request: Request) {
  const totalStarted = performance.now()
  let body: LiveBody
  try {
    body = await request.json()
  } catch {
    return fail('Request body must be JSON.', 400)
  }

  const text = body.text
  if (typeof text !== 'string' || text.length === 0 || text.length > 4000) {
    return fail('Invalid text.', 400)
  }

  const level = typeof body.level === 'string' && body.level.trim() ? body.level.trim() : 'B1'
  const contextBefore = typeof body.contextBefore === 'string' ? body.contextBefore.slice(0, 2000) : ''
  const contextAfter = typeof body.contextAfter === 'string' ? body.contextAfter.slice(0, 2000) : ''
  const documentOffset =
    typeof body.documentOffset === 'number' && Number.isInteger(body.documentOffset) && body.documentOffset >= 0
      ? body.documentOffset
      : 0

  try {
    const { data, modelMs } = await createStructuredResponse<{ annotations: unknown[] }>({
      model: LIVE_FEEDBACK_MODEL,
      reasoningEffort: LIVE_FEEDBACK_REASONING_EFFORT,
      system: liveFeedbackSystemPrompt,
      user: buildLiveFeedbackUserPrompt({ level, text, contextBefore, contextAfter }),
      schemaName: 'swedish_live_feedback',
      schema: liveFeedbackSchema as unknown as Record<string, unknown>,
      signal: request.signal,
    })

    const totalMs = Math.round(performance.now() - totalStarted)
    const payload = {
      annotations: Array.isArray(data.annotations) ? data.annotations.slice(0, 4) : [],
      documentOffset,
      timing: { modelMs, totalMs },
    }

    const response = NextResponse.json(payload)
    response.headers.set('Server-Timing', `model;dur=${modelMs}, total;dur=${totalMs}`)
    if (process.env.NODE_ENV === 'development') {
      console.info('[feedback/live]', { model: LIVE_FEEDBACK_MODEL, modelMs, totalMs, chars: text.length })
    }
    return response
  } catch (error) {
    if (isAbortError(error)) {
      return fail('Aborted.', 499)
    }
    if (error instanceof MissingApiKeyError) {
      return fail(error.message, 503)
    }
    const message = error instanceof Error ? error.message : 'Feedback request failed.'
    return fail(message, 502)
  }
}
