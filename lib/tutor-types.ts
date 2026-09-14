export type CEFRLevel = 'A2' | 'B1' | 'B2'

export type TutorMessage = {
  role: 'user' | 'assistant'
  content: string
}

export type TutorSelection = {
  start: number
  end: number
  text: string
}

export type TutorChatRequest = {
  message: string
  level: CEFRLevel
  document: string
  useDocument?: boolean
  cursorOffset?: number
  selection?: TutorSelection
  messages: TutorMessage[]
}

export type EditorContext = {
  cursorOffset?: number
  selection?: TutorSelection
}
