import { NextResponse } from 'next/server'

import {
  buildTutorInput,
  capDocumentContext,
  TUTOR_MAX_HISTORY_CHARS,
  TUTOR_MAX_HISTORY_MESSAGES,
  TUTOR_MAX_MESSAGE_CHARS,
  tutorSystemPrompt,
} from '@/config/tutor'
import { TUTOR_CHAT_MODEL } from '@/config/models'
import { createStreamingTextResponse, isAbortError, MissingApiKeyError } from '@/lib/openai'
import type { CEFRLevel, TutorChatRequest, TutorMessage, TutorSelection } from '@/lib/tutor-types'

type TutorBody = Partial<TutorChatRequest> & {
  message?: unknown
  level?: unknown
  document?: unknown
  useDocument?: unknown
  cursorOffset?: unknown
  selection?: unknown
  messages?: unknown
}

const LEVELS = new Set<CEFRLevel>(['A2', 'B1', 'B2'])

function fail(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

function parseLevel(value: unknown): CEFRLevel {
  if (typeof value === 'string' && LEVELS.has(value as CEFRLevel)) {
    return value as CEFRLevel
  }
  return 'B1'
}

function parseMessages(value: unknown): TutorMessage[] {
  if (!Array.isArray(value)) return []

  const parsed: TutorMessage[] = []
  let totalChars = 0

  for (const item of value.slice(-TUTOR_MAX_HISTORY_MESSAGES)) {
    if (!item || typeof item !== 'object') continue
    const role = (item as { role?: unknown }).role
    const content = (item as { content?: unknown }).content
    if (role !== 'user' && role !== 'assistant') continue
    if (typeof content !== 'string' || content.length === 0) continue
    const trimmed = content.slice(0, TUTOR_MAX_MESSAGE_CHARS)
    totalChars += trimmed.length
    if (totalChars > TUTOR_MAX_HISTORY_CHARS) break
    parsed.push({ role, content: trimmed })
  }

  return parsed
}

function parseSelection(value: unknown): TutorSelection | undefined {
  if (!value || typeof value !== 'object') return undefined
  const start = (value as { start?: unknown }).start
  const end = (value as { end?: unknown }).end
  const text = (value as { text?: unknown }).text
  if (
    typeof start !== 'number' ||
    typeof end !== 'number' ||
    typeof text !== 'string' ||
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    end <= start ||
    text.length === 0
  ) {
    return undefined
  }
  return { start, end, text: text.slice(0, 500) }
}

export async function POST(request: Request) {
  let body: TutorBody
  try {
    body = await request.json()
  } catch {
    return fail('Request body must be JSON.', 400)
  }

  const message = body.message
  if (typeof message !== 'string' || message.trim().length === 0 || message.length > TUTOR_MAX_MESSAGE_CHARS) {
    return fail('Invalid message.', 400)
  }

  const level = parseLevel(body.level)
  const document =
    typeof body.document === 'string' ? capDocumentContext(body.document) : ''
  const useDocument = body.useDocument !== false
  const cursorOffset =
    typeof body.cursorOffset === 'number' &&
    Number.isInteger(body.cursorOffset) &&
    body.cursorOffset >= 0
      ? body.cursorOffset
      : undefined
  const selection = parseSelection(body.selection)
  const messages = parseMessages(body.messages)

  try {
    const input = buildTutorInput({
      level,
      message: message.trim(),
      document,
      useDocument,
      cursorOffset,
      selection,
      messages,
    })

    const stream = await createStreamingTextResponse({
      model: TUTOR_CHAT_MODEL,
      instructions: tutorSystemPrompt(level),
      input,
      signal: request.signal,
    })

    const encoder = new TextEncoder()

    const readable = new ReadableStream({
      async start(controller) {
        try {
          for await (const event of stream) {
            if (event.type === 'response.output_text.delta' && typeof event.delta === 'string') {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ delta: event.delta })}\n\n`))
            } else if (event.type === 'error') {
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ error: event.message || 'Tutor request failed.' })}\n\n`),
              )
            } else if (event.type === 'response.failed') {
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ error: 'Tutor request failed.' })}\n\n`),
              )
            }
          }
          controller.enqueue(encoder.encode('data: [DONE]\n\n'))
          controller.close()
        } catch (error) {
          if (isAbortError(error)) {
            controller.close()
            return
          }
          const detail = error instanceof Error ? error.message : 'Tutor request failed.'
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: detail })}\n\n`))
          controller.close()
        }
      },
    })

    return new Response(readable, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
      },
    })
  } catch (error) {
    if (isAbortError(error)) {
      return fail('Aborted.', 499)
    }
    if (error instanceof MissingApiKeyError) {
      return fail(error.message, 503)
    }
    const detail = error instanceof Error ? error.message : 'Tutor request failed.'
    return fail(detail, 502)
  }
}
