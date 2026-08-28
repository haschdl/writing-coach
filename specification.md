# Swedish Writing Advisor Specification

## Summary

Build an interactive Swedish writing assistant that helps learners improve their written Swedish in real time. Users write directly in an editable text area, receive feedback from an OpenAI-backed API, and see the relevant parts of their text highlighted with inline annotations.

## Core experience

- Provide a blank, editable writing surface for the user.
- Let users type naturally without the caret jumping or the editor being replaced during feedback requests.
- Show a clear thinking/loading state while feedback is being generated.
- Send the current text and the learner's level to the feedback API.
- Render returned annotations directly over the matching text spans.
- Support spelling, word order, grammar, verb form, agreement, pronouns, idiomatic usage, style, and positive feedback categories.
- Display the explanation, correction, hint, and applicable Swedish rule when an annotation is selected or inspected.
- Remove stale annotations when the user changes the text and apply only feedback belonging to the latest response.

## Feedback API

The API accepts the current writing sample and proficiency level, then uses an OpenAI structured JSON response to return annotation data. Each annotation should include a stable identifier, the text span or character offsets, category, label, hint, explanation, correction, and rule. The client must validate and normalize the response, resolve inaccurate offsets by matching the returned annotation text against the current source text, and ignore malformed annotations.

## Technical requirements

- Use the existing Next.js App Router project.
- Keep OpenAI calls server-side in `app/api/feedback/route.ts`.
- Preserve the native contentEditable DOM and selection while the user types.
- Avoid rebuilding the editor on every keystroke.
- Reapply decorations only when a valid feedback response arrives.
- Ensure annotations are associated with the exact text submitted for that request, preventing stale responses from overwriting newer input.
- Keep the UI accessible with semantic controls, keyboard support, and readable annotation explanations.

## Current implementation focus

The immediate priority is making live feedback reliable: fresh text should trigger the API, the API response should produce visible decorations, and the caret should remain at the user's typing position throughout the loading and rendering lifecycle.
