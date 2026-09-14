/** Central model configuration for live typing analysis. Swap here to A/B test. */
export const LIVE_FEEDBACK_MODEL = 'gpt-5.4-nano'

/** Reasoning effort for live analysis — prefer speed over deliberation. */
export const LIVE_FEEDBACK_REASONING_EFFORT = 'none' as const

/** Model for on-demand Explain / Show correction (still latency-oriented). */
export const DEEP_FEEDBACK_MODEL = 'gpt-5.4-nano'

export const DEEP_FEEDBACK_REASONING_EFFORT = 'none' as const

/** Conversational tutor — richer explanations than live feedback; still latency-oriented. */
export const TUTOR_CHAT_MODEL = 'gpt-4.1-mini'
