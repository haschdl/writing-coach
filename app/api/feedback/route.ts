import { NextResponse } from 'next/server'

const schema = {
  type: 'object',
  properties: {
    annotations: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, start: { type: 'integer' }, end: { type: 'integer' }, text: { type: 'string' }, category: { type: 'string' }, label: { type: 'string' }, hint: { type: 'string' }, explanation: { type: 'string' }, correction: { type: 'string' }, rule: { type: 'string' } }, required: ['id', 'start', 'end', 'text', 'category', 'label', 'hint', 'explanation', 'correction', 'rule'], additionalProperties: false } },
    patterns: { type: 'array', items: { type: 'object', properties: { category: { type: 'string' }, count: { type: 'integer' }, message: { type: 'string' } }, required: ['category', 'count', 'message'], additionalProperties: false } },
  }, required: ['annotations', 'patterns'], additionalProperties: false,
}

export async function POST(request: Request) {
  const { text, level } = await request.json()
  if (typeof text !== 'string' || text.length > 12000) return NextResponse.json({ error: 'Invalid text' }, { status: 400 })
  if (!process.env.OPENAI_API_KEY) return NextResponse.json({ annotations: [], patterns: [] })
  const prompt = `You are a kind Swedish tutor. Review this ${level} learner writing. Return only JSON matching the schema. Identify at most 6 high-value, smallest-span learning opportunities. Distinguish incorrect Swedish from understandable but unnatural phrasing. Do not flag valid learner Swedish just to make it native. Use English explanations. Categories: spelling, noun_gender, adjective_agreement, verb_form, word_order, subordinate_clause, pronoun, reflexive, idiomatic, style, positive. Give hints before answers. Text: ${text}`
  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.OPENAI_API_KEY}` }, body: JSON.stringify({ model: 'gpt-4o-mini', temperature: 0.2, messages: [{ role: 'system', content: 'Return semantic annotations only. Never return HTML.' }, { role: 'user', content: prompt }], response_format: { type: 'json_schema', json_schema: { name: 'swedish_feedback', strict: true, schema } } }) })
    if (!response.ok) return NextResponse.json({ annotations: [], patterns: [] })
    const data = await response.json()
    return NextResponse.json(JSON.parse(data.choices?.[0]?.message?.content ?? '{"annotations":[],"patterns":[]}'))
  } catch { return NextResponse.json({ annotations: [], patterns: [] }) }
}
