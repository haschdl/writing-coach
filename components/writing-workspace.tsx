'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'

import { ScrivEditor } from '@/components/scriv-editor'
import { TutorMobileTrigger, TutorPanel, useTutorPanelState } from '@/components/tutor-panel'
import { getEditorContext, readEditorText } from '@/lib/editor-text'
import type { CEFRLevel, EditorContext } from '@/lib/tutor-types'

function currentEditor() {
  return document.querySelector<HTMLElement>('.editor[contenteditable="true"]') ?? document.querySelector<HTMLElement>('.editor')
}

function currentLevel(): CEFRLevel {
  const value = document.querySelector<HTMLSelectElement>('#level')?.value
  return value === 'A2' || value === 'B2' ? value : 'B1'
}

export function WritingWorkspace() {
  // Keep the editor element identity stable so tutor-context updates never re-render
  // the latency-sensitive writing surface.
  const editor = useMemo(() => <ScrivEditor />, [])
  const { desktopOpen, setDesktopOpen, mobileOpen, setMobileOpen } = useTutorPanelState()
  const [draft, setDraft] = useState('')
  const [level, setLevel] = useState<CEFRLevel>('B1')

  useEffect(() => {
    let timer: number | undefined

    const snapshot = () => {
      const root = currentEditor()
      if (root) setDraft(readEditorText(root))
      setLevel(currentLevel())
    }

    const scheduleSnapshot = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(snapshot, 120)
    }

    snapshot()
    document.addEventListener('input', scheduleSnapshot, true)
    document.addEventListener('change', scheduleSnapshot, true)

    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('input', scheduleSnapshot, true)
      document.removeEventListener('change', scheduleSnapshot, true)
    }
  }, [])

  const getTutorEditorContext = useCallback((): EditorContext => {
    const root = currentEditor()
    return root ? getEditorContext(root, readEditorText(root)) : {}
  }, [])

  return (
    <div className="workspace-shell mx-auto flex w-full max-w-[1600px] items-stretch">
      <div className="min-w-0 flex-1">{editor}</div>

      <TutorPanel
        level={level}
        document={draft}
        getEditorContext={getTutorEditorContext}
        desktopOpen={desktopOpen}
        onDesktopOpenChange={setDesktopOpen}
        mobileOpen={mobileOpen}
        onMobileOpenChange={setMobileOpen}
      />

      <div className="fixed bottom-4 right-4 z-30 lg:hidden">
        <TutorMobileTrigger onClick={() => setMobileOpen(true)} />
      </div>
    </div>
  )
}
