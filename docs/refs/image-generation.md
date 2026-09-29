# REF: Gemini image generation / Nano Banana (fetched from ai.google.dev 2026-07-11 — source: /gemini-api/docs/image-generation)
Source text © Google, CC-BY 4.0.

## Model IDs (T3 shootout candidates)
| Model | ID | Notes |
|---|---|---|
| NB2 Lite | `gemini-3.1-flash-lite-image` | fastest/cheapest · 1K only · NO search grounding · NO character consistency · not optimized for editing |
| **NB2 (default expectation)** | `gemini-3.1-flash-image` | most versatile · 512px–4K · search grounding · up to 14 reference images |
| NB Pro | `gemini-3-pro-image` | premium, interleaved text+images — overkill for us |

## Edit call (image + instruction) — Python
```python
interaction = client.interactions.create(
    model="gemini-3.1-flash-image",
    input=[
        {"type": "text", "text": "your edit instruction"},
        {"type": "image", "data": base64_encoded_image, "mime_type": "image/png"},
    ],
)
```
JS mirror: `await ai.interactions.create({ model, input: [{type:"text",...},{type:"image",...}] })`

## Output field
`interaction.output_image.data` → base64. (Interleaved steps iteration only needed on Pro.)

## Multi-turn editing
```python
interaction_2 = client.interactions.create(
    model="gemini-3.1-flash-image",
    input="now make the cushions terracotta",
    previous_interaction_id=interaction.id,
    response_format={"type": "image", "aspect_ratio": "16:9"},
)
```

## Notes for /variants (T8)
- Aspect ratios incl. 16:9 / 4:3 / 3:4 etc. Resolution values use uppercase K ("1K", "2K").
- Thinking is on by default and billed — irrelevant at our volume, ignore.
- For identity preservation: describe the elements to KEEP in detail (our edit wrapper does this).
