import { NextResponse } from 'next/server'

import { buildFeedbackPrompt, feedbackSystemPrompt } from '@/config/feedback'
import { describeNetworkError } from '@/lib/network-error'

const schema = {
  type: 'object',
  properties: {
    annotations: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, start: { type: 'integer' }, end: { type: 'integer' }, text: { type: 'string' }, category: { type: 'string' }, label: { type: 'string' }, hint: { type: 'string' }, explanation: { type: 'string' }, correction: { type: 'string' }, rule: { type: 'string' } }, required: ['id', 'start', 'end', 'text', 'category', 'label', 'hint', 'explanation', 'correction', 'rule'], additionalProperties: false } },
    patterns: { type: 'array', items: { type: 'object', properties: { category: { type: 'string' }, count: { type: 'integer' }, message: { type: 'string' } }, required: ['category', 'count', 'message'], additionalProperties: false } },
  }, required: ['annotations', 'patterns'], additionalProperties: false,
}

function fail(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

export async function POST(request: Request) {
  let body: { text?: unknown; level?: unknown }
  try {
    body = await request.json()
  } catch {
    return fail('Request body must be JSON.', 400)
  }

  const { text, level } = body
  if (typeof text !== 'string' || text.length > 12000) return fail('Invalid text.', 400)
  if (!process.env.OPENAI_API_KEY) {
    return fail('OPENAI_API_KEY is missing. Add it to .env or .env.local, then restart the dev server.', 503)
  }

  const prompt = buildFeedbackPrompt(text, level)
  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0.2,
        messages: [
          { role: 'system', content: feedbackSystemPrompt },
          { role: 'user', content: prompt },
        ],
        response_format: { type: 'json_schema', json_schema: { name: 'swedish_feedback', strict: true, schema } },
      }),
    })
    if (!response.ok) {
      const detail = await openaiError(response)
      return fail(detail, 502)
    }
    const data = await response.json()
    const content = data.choices?.[0]?.message?.content
    if (typeof content !== 'string' || content.length === 0) {
      return fail('OpenAI returned an empty response.', 502)
    }
    try {
      return NextResponse.json(JSON.parse(content))
    } catch {
      return fail('OpenAI returned invalid JSON.', 502)
    }
  } catch (error) {
    return fail(describeNetworkError(error), 502)
  }
}

async function openaiError(response: Response) {
  try {
    const payload = await response.json()
    if (typeof payload?.error?.message === 'string' && payload.error.message.length > 0) {
      return payload.error.message
    }
  } catch {
    /* Use the status line when the error body is not JSON. */
  }
  return `OpenAI request failed (${response.status} ${response.statusText}).`
}
