# REF: Gemini Live API (fetched from ai.google.dev 2026-07-11 — source: /gemini-api/docs/live + /docs/live-tools)
Local reference so coding agents use real field names. Source text © Google, CC-BY 4.0.

## Session basics
- Model: `gemini-3.1-flash-live-preview`. Stateful **WebSocket (WSS)**; client-to-server from the
  browser is the recommended pattern for streaming performance (use ephemeral tokens in prod;
  plain API key acceptable for a hackathon demo).
- **Input:** raw 16-bit PCM audio, 16 kHz, little-endian · JPEG images at ≤ 1 FPS · text.
- **Output:** raw 16-bit PCM audio, 24 kHz, little-endian. Transcripts available for both sides.
- Barge-in supported natively ("users can interrupt the model at any time"). 70 languages.
- **Session cap: 2 min audio+video / 15 min audio-only** (see RESEARCH.md) → timer + reconnect ritual.

## Tools in session config (JS)
```javascript
const tools = [
  { googleSearch: {} },                                    // coexists with functions — CONFIRMED
  { functionDeclarations: [generate_variants, play_scene, compile_brief] }
]
const config = { responseModalities: [Modality.AUDIO], tools: tools }
```

## Tool calls arrive as
```javascript
if (turn.toolCall) {
  for (const fc of turn.toolCall.functionCalls) {
    // fc.id, fc.name, fc.args
  }
}
```

## Respond with
```javascript
session.sendToolResponse({ functionResponses: [{
  id: fc.id, name: fc.name, response: { result: "ok" }
}]});
```

## ⚠️ CRITICAL for T5: no async functions on this model
`Behavior.NON_BLOCKING` / scheduling (INTERRUPT · WHEN_IDLE · SILENT) is **not supported on
Gemini 3.1 Flash Live**. Therefore long-running tools (generate_variants ≈ several seconds,
compile_brief) MUST:
1. `sendToolResponse` IMMEDIATELY with `{ result: "Generating 4 options now — they'll appear on
   the rail in a few seconds. Keep chatting." }` so the conversation never stalls;
2. run the actual POST /variants client-side async; the rail + brain feed update when results land.
Never make the model wait on the HTTP call.
