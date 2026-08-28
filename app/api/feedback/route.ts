import { NextResponse } from 'next/server'

const schema = {
  type: 'object',
  properties: {
    annotations: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, start: { type: 'integer' }, end: { type: 'integer' }, text: { type: 'string' }, category: { type: 'string' }, label: { type: 'string' }, hint: { type: 'string' }, explanation: { type: 'string' }, correction: { type: 'string' }, rule: { type: 'string' } }, required: ['id', 'start', 'end', 'text', 'category', 'label', 'hint', 'explanation', 'correction', 'rule'], additionalProperties: false } },
    patterns: { type: 'array', items: { type: 'object', properties: { category: { type: 'string' }, count: { type: 'integer' }, message: { type: 'string' } }, required: ['category', 'count', 'message'], additionalProperties: false } },
  }, required: ['annotations', 'patterns'], additionalProperties: false,
}

function isFeedbackPayload(value: unknown): value is {
  annotations: Array<Record<string, unknown>>
  patterns: Array<Record<string, unknown>>
} {
  if (!value || typeof value !== 'object') return false
  const payload = value as { annotations?: unknown; patterns?: unknown }
  return Array.isArray(payload.annotations) && Array.isArray(payload.patterns) && payload.annotations.every((item) => {
    if (!item || typeof item !== 'object') return false
    const annotation = item as Record<string, unknown>
    return ['id', 'start', 'end', 'text', 'category', 'label', 'hint', 'explanation', 'correction', 'rule'].every((key) => key in annotation)
      && Number.isInteger(annotation.start) && Number.isInteger(annotation.end)
      && Object.values(annotation).every((field) => typeof field === 'string' || typeof field === 'number')
  })
}

function getProvider() {
  const openAIKey = process.env.OPENAI_API_KEY?.trim()
  if (openAIKey) return { name: 'Native', apiKey: openAIKey, baseUrl: 'https://api.openai.com/v1', model: process.env.OPENAI_MODEL?.trim() || 'gpt-4o-mini' }
  const databricksKey = process.env.DATABRICKS_API_KEY?.trim()
  const baseUrl = process.env.DATABRICKS_BASE_URL?.trim().replace(/\/$/, '')
  const model = process.env.DATABRICKS_MODEL?.trim()
  if (databricksKey && baseUrl && model) return { name: 'Databricks', apiKey: databricksKey, baseUrl, model }
  return null
}

export async function GET() {
  const provider = getProvider()
  return NextResponse.json({ configured: Boolean(provider), provider: provider?.name ?? null })
}

export async function POST(request: Request) {
  const { text, level } = await request.json()
  if (typeof text !== 'string' || text.length > 12000) return NextResponse.json({ error: 'Invalid text' }, { status: 400 })
  const provider = getProvider()
  if (!provider) {
    console.warn('[v0] No AI feedback provider is configured; set OPENAI_API_KEY or the Databricks variables.')
    return NextResponse.json(
      { annotations: [], patterns: [], warning: 'AI feedback is unavailable because no provider is fully configured.' },
      { status: 503 },
    )
  }
  const prompt = `Review this ${level} learner's Swedish as a kind tutor. Identify at most 6 high-value, smallest-span learning opportunities. Distinguish incorrect Swedish from understandable but unnatural phrasing, and do not flag valid learner Swedish just to make it native. Use English explanations. Flag typos as category typo, including missing Swedish diacritics such as “mar” in “Hur mar du?”; use the exact text span and provide the correction. Give hints before answers. Analyze only this text:\n${text}`
  try {
    const isDatabricks = provider.name === 'Databricks'
    const response = await fetch(`${provider.baseUrl}/${isDatabricks ? 'responses' : 'chat/completions'}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${provider.apiKey}` },
      body: JSON.stringify(isDatabricks
        ? { model: provider.model, max_output_tokens: 1200, input: [{ role: 'user', content: [{ type: 'input_text', text: prompt }] }] }
        : {
            model: provider.model,
            temperature: 0.2,
            messages: [{ role: 'user', content: prompt }],
            response_format: {
              type: 'json_schema',
              json_schema: { name: 'swedish_feedback', strict: true, schema },
            },
          }),
    })
    if (!response.ok) {
      const details = await response.text()
      console.error(`[v0] ${provider.name} feedback request failed (${response.status}): ${details.slice(0, 500)}`)
      return NextResponse.json(
        { annotations: [], patterns: [], warning: `${provider.name} feedback is unavailable (${response.status}). Check the provider credentials, endpoint, and account access.` },
        { status: 502 },
      )
    }
    const data = await response.json()
    const outputText = isDatabricks
      ? data.output_text
      : data.choices?.[0]?.message?.content
    if (typeof outputText !== 'string' || !outputText.trim()) throw new Error(`${provider.name} returned no structured output`)
    let parsed: unknown
    try {
      parsed = JSON.parse(outputText)
    } catch {
      throw new Error(`${provider.name} returned invalid JSON instead of the requested structured output`)
    }
    if (!isFeedbackPayload(parsed)) throw new Error(`${provider.name} returned JSON that does not match the feedback schema`)
    const rawAnnotations = parsed.annotations
    const annotations = rawAnnotations
      ? rawAnnotations.flatMap((item: Record<string, unknown>, index: number) => {
          const value = typeof item.text === 'string' ? item.text : typeof item.incorrect === 'string' ? item.incorrect : ''
          const start = value ? text.indexOf(value) : -1
          if (start < 0) return []
          const category = typeof item.category === 'string' ? item.category : 'style'
          return [{
            id: typeof item.id === 'string' ? item.id : `ai-${index}-${start}`,
            start,
            end: start + value.length,
            text: value,
            category,
            label: typeof item.label === 'string' ? item.label : category.replaceAll('_', ' '),
            hint: typeof item.hint === 'string' ? item.hint : 'What could you change here?',
            explanation: typeof item.explanation === 'string' ? item.explanation : '',
            correction: typeof item.correction === 'string' ? item.correction : '',
            rule: typeof item.rule === 'string' ? item.rule : category,
          }]
        })
      : []
    return NextResponse.json({ annotations, patterns: Array.isArray(parsed.patterns) ? parsed.patterns : [] })
  } catch (error) {
    console.error('[v0] Databricks feedback request error:', error)
    return NextResponse.json(
      { annotations: [], patterns: [], warning: 'OpenAI feedback could not be completed. Check the server logs.' },
      { status: 502 },
    )
  }
}
