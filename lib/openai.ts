import OpenAI from 'openai'

import { describeNetworkError } from '@/lib/network-error'

let client: OpenAI | null = null

export function getOpenAIClient() {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    throw new MissingApiKeyError()
  }
  if (!client) {
    client = new OpenAI({ apiKey })
  }
  return client
}

export class MissingApiKeyError extends Error {
  constructor() {
    super('OPENAI_API_KEY is missing. Add it to .env or .env.local, then restart the dev server.')
    this.name = 'MissingApiKeyError'
  }
}

export async function createStructuredResponse<T>(options: {
  model: string
  reasoningEffort?: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'
  system: string
  user: string
  schemaName: string
  schema: Record<string, unknown>
  signal?: AbortSignal
}): Promise<{ data: T; modelMs: number }> {
  const openai = getOpenAIClient()
  const started = performance.now()

  try {
    const response = await openai.responses.create(
      {
        model: options.model,
        reasoning: options.reasoningEffort ? { effort: options.reasoningEffort } : undefined,
        instructions: options.system,
        input: options.user,
        text: {
          format: {
            type: 'json_schema',
            name: options.schemaName,
            strict: true,
            schema: options.schema,
          },
        },
      },
      options.signal ? { signal: options.signal } : undefined,
    )

    const modelMs = Math.round(performance.now() - started)
    const content = response.output_text
    if (typeof content !== 'string' || content.length === 0) {
      throw new Error('OpenAI returned an empty response.')
    }

    try {
      return { data: JSON.parse(content) as T, modelMs }
    } catch {
      throw new Error('OpenAI returned invalid JSON.')
    }
  } catch (error) {
    if (error instanceof MissingApiKeyError) throw error
    if (isAbortError(error)) throw error
    if (error instanceof OpenAI.APIError) {
      throw new Error(error.message || `OpenAI request failed (${error.status}).`)
    }
    throw new Error(describeNetworkError(error))
  }
}

export function isAbortError(error: unknown) {
  if (!error || typeof error !== 'object') return false
  const name = (error as { name?: unknown }).name
  if (name === 'AbortError' || name === 'APIUserAbortError') return true
  return false
}
