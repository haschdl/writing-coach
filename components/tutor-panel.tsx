'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  FileText,
  MessageCircle,
  PanelRightClose,
  PanelRightOpen,
  RotateCcw,
  SendHorizontal,
  X,
} from 'lucide-react'

import type { CEFRLevel, EditorContext, TutorMessage } from '@/lib/tutor-types'

const PANEL_OPEN_KEY = 'skriv-tutor-panel-open'
const CHAT_STORAGE_KEY = 'skriv-tutor-chat-v1'

const SUGGESTIONS = [
  'How would I say…?',
  "What's the difference between…?",
  'Why is this word order?',
  'Does this sound natural?',
]

type TutorPanelProps = {
  level: CEFRLevel
  document: string
  getEditorContext: () => EditorContext
  desktopOpen: boolean
  onDesktopOpenChange: (open: boolean) => void
  mobileOpen: boolean
  onMobileOpenChange: (open: boolean) => void
}

function loadStoredMessages(): TutorMessage[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = sessionStorage.getItem(CHAT_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter(
        (item): item is TutorMessage =>
          !!item &&
          typeof item === 'object' &&
          (item as TutorMessage).role !== undefined &&
          ((item as TutorMessage).role === 'user' || (item as TutorMessage).role === 'assistant') &&
          typeof (item as TutorMessage).content === 'string',
      )
      .slice(-40)
  } catch {
    return []
  }
}

function loadPanelOpen(): boolean {
  if (typeof window === 'undefined') return true
  try {
    const raw = localStorage.getItem(PANEL_OPEN_KEY)
    if (raw === null) return true
    return raw === 'true'
  } catch {
    return true
  }
}

function formatInline(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g)
  return parts.map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={index}>{part.slice(2, -2)}</strong>
    }
    if (part.startsWith('*') && part.endsWith('*')) {
      return <em key={index}>{part.slice(1, -1)}</em>
    }
    return part
  })
}

function TutorMessageBody({ content }: { content: string }) {
  const blocks = content.split(/\n{2,}/)

  return (
    <div className="tutor-message-body">
      {blocks.map((block, index) => {
        const lines = block.split('\n')
        const isList = lines.every((line) => /^[-*]\s+/.test(line.trim()) || line.trim() === '')

        if (isList && lines.some((line) => /^[-*]\s+/.test(line.trim()))) {
          return (
            <ul key={index} className="my-2 list-disc space-y-1 pl-5">
              {lines
                .filter((line) => line.trim())
                .map((line, lineIndex) => (
                  <li key={lineIndex}>{formatInline(line.replace(/^[-*]\s+/, ''))}</li>
                ))}
            </ul>
          )
        }

        return (
          <p key={index} className={index > 0 ? 'mt-3' : undefined}>
            {lines.map((line, lineIndex) => (
              <span key={lineIndex}>
                {lineIndex > 0 && <br />}
                {formatInline(line)}
              </span>
            ))}
          </p>
        )
      })}
    </div>
  )
}

function TutorPanelContent({
  level,
  document,
  getEditorContext,
  onClose,
  showCollapse,
  onCollapse,
}: {
  level: CEFRLevel
  document: string
  getEditorContext: () => EditorContext
  onClose?: () => void
  showCollapse?: boolean
  onCollapse?: () => void
}) {
  const [messages, setMessages] = useState<TutorMessage[]>([])
  const [input, setInput] = useState('')
  const [thinking, setThinking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [useDocument, setUseDocument] = useState(true)
  const [hydrated, setHydrated] = useState(false)
  const messagesRef = useRef<HTMLDivElement>(null)
  const scrollAnchorRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const scrollSnapshotRef = useRef<number | null>(null)

  useEffect(() => {
    setMessages(loadStoredMessages())
    setHydrated(true)
  }, [])

  useEffect(() => {
    if (!hydrated) return
    try {
      sessionStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(messages))
    } catch {
      // Ignore quota errors.
    }
  }, [messages, hydrated])

  useEffect(() => {
    const container = messagesRef.current
    if (!container) return
    if (scrollSnapshotRef.current !== null) {
      container.scrollTop = scrollSnapshotRef.current
      scrollSnapshotRef.current = null
      return
    }
    scrollAnchorRef.current?.scrollIntoView({ block: 'end' })
  }, [messages, thinking])

  useEffect(() => () => abortRef.current?.abort(), [])

  const clearChat = useCallback(() => {
    abortRef.current?.abort()
    setMessages([])
    setError(null)
    setThinking(false)
    setInput('')
  }, [])

  async function sendMessage(raw: string) {
    const trimmed = raw.trim()
    if (!trimmed || thinking) return

    const userMessage: TutorMessage = { role: 'user', content: trimmed }
    const history = messages
    const editorContext = getEditorContext()

    setMessages((prev) => [...prev, userMessage, { role: 'assistant', content: '' }])
    setInput('')
    setThinking(true)
    setError(null)

    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    try {
      const response = await fetch('/api/tutor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          message: trimmed,
          level,
          document,
          useDocument,
          cursorOffset: editorContext.cursorOffset,
          selection: editorContext.selection,
          messages: history,
        }),
      })

      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(typeof data.error === 'string' ? data.error : `Tutor request failed (${response.status}).`)
      }

      if (!response.body) {
        throw new Error('Tutor response stream was empty.')
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const chunks = buffer.split('\n\n')
        buffer = chunks.pop() ?? ''

        for (const chunk of chunks) {
          const line = chunk.trim()
          if (!line.startsWith('data:')) continue
          const payload = line.slice(5).trim()
          if (payload === '[DONE]') continue

          let parsed: { delta?: string; error?: string }
          try {
            parsed = JSON.parse(payload) as { delta?: string; error?: string }
          } catch {
            continue
          }

          if (typeof parsed.error === 'string') {
            throw new Error(parsed.error)
          }

          if (typeof parsed.delta === 'string' && parsed.delta.length > 0) {
            setMessages((prev) => {
              const next = [...prev]
              const last = next[next.length - 1]
              if (!last || last.role !== 'assistant') return prev
              next[next.length - 1] = { ...last, content: last.content + parsed.delta }
              return next
            })
          }
        }
      }
    } catch (err) {
      if (controller.signal.aborted) return
      const message = err instanceof Error ? err.message : 'Tutor request failed.'
      setError(message)
      setMessages((prev) => {
        const next = [...prev]
        const last = next[next.length - 1]
        if (last?.role === 'assistant' && last.content.length === 0) {
          next.pop()
        }
        return next
      })
    } finally {
      if (!controller.signal.aborted) setThinking(false)
    }
  }

  function handleSubmit(event?: React.FormEvent) {
    event?.preventDefault()
    void sendMessage(input)
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      handleSubmit()
    }
  }

  return (
    <div className="tutor-panel-inner flex h-full min-h-0 flex-col">
      <div className="tutor-panel-header flex shrink-0 items-start justify-between gap-3 border-b border-border/80 px-4 py-4">
        <div>
          <h2 className="font-serif text-lg leading-none tracking-tight">Tutor</h2>
          <p className="mt-1 text-xs text-muted-foreground">Ask anything about your Swedish</p>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label="Start new chat"
            title="New chat"
            onClick={clearChat}
            className="rounded-full p-2 text-muted-foreground transition hover:bg-muted hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <RotateCcw className="h-4 w-4" />
          </button>
          {showCollapse && onCollapse && (
            <button
              type="button"
              aria-label="Collapse tutor panel"
              onClick={onCollapse}
              className="rounded-full p-2 text-muted-foreground transition hover:bg-muted hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <PanelRightClose className="h-4 w-4" />
            </button>
          )}
          {onClose && (
            <button
              type="button"
              aria-label="Close tutor"
              onClick={onClose}
              className="rounded-full p-2 text-muted-foreground transition hover:bg-muted hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      <div ref={messagesRef} className="tutor-messages min-h-0 flex-1 overflow-y-auto px-4 py-4" aria-live="polite">
        {messages.length === 0 ? (
          <div className="tutor-empty">
            <p className="text-sm leading-6 text-muted-foreground">
              Ask about a word, sentence, grammar rule, or how to express something.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              {SUGGESTIONS.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  className="rounded-full border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground transition hover:border-foreground/25 hover:text-foreground"
                  onClick={() => void sendMessage(suggestion)}
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {messages.map((message, index) => (
              <div
                key={`${index}-${message.role}`}
                className={message.role === 'user' ? 'tutor-message-user' : 'tutor-message-assistant'}
              >
                {message.role === 'user' ? (
                  <div className="rounded-2xl bg-secondary/80 px-3 py-2 text-sm leading-6">{message.content}</div>
                ) : message.content ? (
                  <div className="text-sm leading-6 text-foreground/90">
                    <TutorMessageBody content={message.content} />
                  </div>
                ) : thinking ? (
                  <p className="text-sm text-muted-foreground">Thinking…</p>
                ) : null}
              </div>
            ))}
          </div>
        )}
        <div ref={scrollAnchorRef} />
      </div>

      {error && (
        <div className="mx-4 mb-2 rounded-xl border border-[#bd6262]/25 bg-[#bd6262]/8 px-3 py-2 text-xs leading-5 text-[#8a3f3f]">
          {error}
          <button
            type="button"
            className="ml-2 underline"
            onClick={() => {
              const lastUser = [...messages].reverse().find((m) => m.role === 'user')
              if (lastUser) void sendMessage(lastUser.content)
            }}
          >
            Retry
          </button>
        </div>
      )}

      <form onSubmit={handleSubmit} className="tutor-composer shrink-0 border-t border-border/80 px-4 py-3">
        <div className="mb-2 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
          <label className="flex items-center gap-1.5">
            <FileText className="h-3 w-3" aria-hidden="true" />
            <span>{useDocument ? 'Using your current draft as context' : 'Draft context off'}</span>
          </label>
          <button
            type="button"
            role="switch"
            aria-checked={useDocument}
            aria-label="Use current draft as context"
            onClick={() => setUseDocument((value) => !value)}
            className={`rounded-full px-2 py-0.5 text-[10px] font-medium transition ${
              useDocument ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {useDocument ? 'On' : 'Off'}
          </button>
        </div>
        <div className="flex items-end gap-2">
          <label className="sr-only" htmlFor="tutor-composer">
            Ask about your Swedish
          </label>
          <textarea
            ref={textareaRef}
            id="tutor-composer"
            rows={2}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about your Swedish…"
            disabled={thinking}
            className="min-h-[44px] flex-1 resize-none rounded-xl border border-border bg-card px-3 py-2 text-sm leading-6 shadow-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-60"
          />
          <button
            type="submit"
            aria-label="Send message"
            disabled={thinking || input.trim().length === 0}
            className="rounded-full bg-primary p-2.5 text-primary-foreground transition hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-40"
          >
            <SendHorizontal className="h-4 w-4" />
          </button>
        </div>
      </form>
    </div>
  )
}

export function TutorPanel({
  level,
  document,
  getEditorContext,
  desktopOpen,
  onDesktopOpenChange,
  mobileOpen,
  onMobileOpenChange,
}: TutorPanelProps) {
  useEffect(() => {
    if (!mobileOpen) return
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onMobileOpenChange(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [mobileOpen, onMobileOpenChange])

  return (
    <>
      {!desktopOpen && (
        <button
          type="button"
          aria-label="Open tutor panel"
          onClick={() => onDesktopOpenChange(true)}
          className="tutor-collapsed-tab hidden lg:flex"
        >
          <MessageCircle className="h-4 w-4" />
          <span>Tutor</span>
        </button>
      )}

      {desktopOpen && (
        <aside
          className="tutor-panel-desktop hidden lg:flex"
          aria-label="AI tutor chat"
        >
          <TutorPanelContent
            level={level}
            document={document}
            getEditorContext={getEditorContext}
            showCollapse
            onCollapse={() => onDesktopOpenChange(false)}
          />
        </aside>
      )}

      {mobileOpen && (
        <div className="tutor-drawer lg:hidden" role="presentation">
          <button
            type="button"
            aria-label="Close tutor overlay"
            className="tutor-drawer-backdrop"
            onClick={() => onMobileOpenChange(false)}
          />
          <aside className="tutor-drawer-panel" aria-label="AI tutor chat">
            <TutorPanelContent
              level={level}
              document={document}
              getEditorContext={getEditorContext}
              onClose={() => onMobileOpenChange(false)}
            />
          </aside>
        </div>
      )}
    </>
  )
}

export function useTutorPanelState() {
  const [desktopOpen, setDesktopOpen] = useState(true)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    setDesktopOpen(loadPanelOpen())
    setReady(true)
  }, [])

  useEffect(() => {
    if (!ready) return
    try {
      localStorage.setItem(PANEL_OPEN_KEY, String(desktopOpen))
    } catch {
      // Ignore storage errors.
    }
  }, [desktopOpen, ready])

  return {
    desktopOpen,
    setDesktopOpen,
    mobileOpen,
    setMobileOpen,
    ready,
  }
}

export function TutorMobileTrigger({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label="Open tutor"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-2 text-xs font-medium text-muted-foreground transition hover:border-foreground/25 hover:text-foreground lg:hidden"
    >
      <PanelRightOpen className="h-4 w-4" />
      Tutor
    </button>
  )
}
