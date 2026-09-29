# MODES.md — the input modes (one page, whole team)
# Companion to CONTRACT.md (exact API shapes) and PROMPTS.md §3b/§3c (prompts).
# PRODUCT (whole-home, 2026-07-11): Vistara designs the WHOLE HOME from one detailed prompt.
# The hero experience is: detailed home description → max two questions → hero-area concepts
# → user picks a style → remaining areas one at a time in that style (VERIFY AT EACH STEP)
# → cinematic tour per area with Asha narrating as a HOME TOUR GUIDE → live interrupts →
# refine → re-tour → the BUILD PACK (floor plan + architect report) as the handoff.
# Camera/upload is the refurbishment side-feature (FIX-IT). Asha never announces modes by name.

## The modes (in priority order)

### 1. DESIGN MY HOME (prompt-first — THE HERO)
The default. Asha opens by inviting the dream home ("Describe the home you're dreaming of —
how many rooms, what goes where, the vibe"). User gives a DETAILED whole-home prompt
("3BHK, four spacious rooms with attached bathrooms, living room with dining table and LED,
a gym room, underground parking, modern techy vibe") → Asha acknowledges the scope, silently
records it (`note_home_spec`), asks at MOST TWO questions (plot/flat? size? budget? — the two
most consequential) → `imagine_space(description)` for the HERO area (living room unless the
user leads elsewhere) → 4 style concepts fill the rail (~18s). VERIFY: user picks one by
voice → the style is recorded (`note_home_spec`) and becomes the home's style → Asha proposes
the next area ("shall we do the gym next?") → `imagine_space` again WITH the chosen style in
the description → verify → repeat, one area at a time. Each confirmed area gets a cinematic
tour on the central screen (`generate_tour`, optional camera/mood instruction; pass
`area_name` when the user names a room — tours are cached per area, so re-touring an
unchanged room is instant, and the tool refuses areas without a locked design: "I don't
have a locked design for X") with Asha narrating as a HOME TOUR GUIDE. A "▶ Tour whole
home" UI button plays each locked room's tour sequentially — Asha narrates each room as
its clip appears. The user can interrupt any time with a change → Asha treats it as
`refine_design` (identity preserved) → offers to re-tour. FINISHING is user-driven: the
"✓ Finish home" button opens the architect pack, and `compile_brief` fires ONLY on an
explicit user ask ("send this to my architect", "prepare the pack", "what will all this
cost") — Asha may suggest it in one sentence but never calls it on her own. It produces
the BUILD PACK — concept floor plan, room-by-room spec, budget, materials & equipment,
approvals checklist — to hand an architect.

### 2. FIX IT (upload — the refurbishment side-feature)
User taps the upload button and gives us a photo of THEIR room. The photo becomes the
standing keyframe; `generate_variants` refurbishes it exactly like a camera frame:
compliment → opportunity → design. No camera required, works on any device.

### 3. SEE IT (live camera — optional variant of FIX-IT)
If the user turns the camera on and shows a room, Asha grounds comments in what's visible
and refurbishes via `generate_variants` with the latest frame. Same behavior as FIX-IT,
just a live keyframe. Not the default open — Asha never waits for a camera.

## Which tool fires when

| User does | Tool | Backend | Input image |
|---|---|---|---|
| Describes the dream home / confirms the next area | `imagine_space(description)` (chosen style folded into the description for every area after the hero) | POST /variants (no keyframe) | none — from scratch |
| Reveals ANY spec fact: home description / picks a style / an area gets designed / a constraint ("east-facing", "we follow vaastu", "kids") / budget / city / size | `note_home_spec(field, value, area_name?)` — `field` = description\|style\|area\|constraint\|budget\|city\|size; SILENT, immediate, one call per fact; this record drives the final floor plan + architect report | client-side spec store | — |
| Asks for a change to the current concept (incl. mid-tour interrupts) | `refine_design(description)` | POST /variants (current concept as keyframe) | current concept |
| Confirms an area / "walk me through it" / names a room to tour ("show me the kitchen") (and after any refine) | `generate_tour(instruction?, area_name?)` — pass `area_name` whenever the user names a room; cached per area (re-tour of an unchanged room is instant); refuses undesigned areas ("I don't have a locked design for X") → Asha offers to design it now | POST /tour + poll GET /tour/{job_id} every 3s (cache hit: instant) | named area's locked concept, else selected rail tile |
| Uploads a photo + direction emerges (FIX-IT) | `generate_variants(description)` | POST /variants | uploaded photo |
| Shows a room on camera + direction emerges (FIX-IT) | `generate_variants(description)` | POST /variants | live camera frame |
| "Show me evening / monsoon" | `play_scene(scene)` | local pre-rendered clip (legacy cached) | — |
| EXPLICITLY asks ("prepare the architect pack" / "send this to my architect" / "what will all this cost") — never on Asha's initiative | `compile_brief()` → BUILD PACK: floor plan + room specs + budget + materials & equipment + legal | POST /brief | — |

Keyframe priority in the web dispatcher (a dispatch mechanic, not product priority —
if they're showing us a room, use it): **live video frame > uploaded photo > current
concept (refine_design) > none (imagine_space)**.

## Latency expectations

| Operation | Expected | Cover story |
|---|---|---|
| /variants concepts (imagine_space), 4 parallel | ~18s to full rail, tiles fill progressively | three-beat wait: commit → narrate decisions → bridge question |
| /variants refine (refine_design) | ~15s | three-beat wait; if mid-tour: "changing those walls now — I'll re-run the walkthrough when it's ready" |
| /tour video (per area, re-callable) | ~50s typical, **40–120s** envelope, poll at 3s | three-beat wait, tour flavor: commit → narrate the camera move ("we'll glide in from the doorway...") → refinement question; keep designing until it lands |
| play_scene | instant (pre-rendered) | — |
| /brief BUILD PACK — floor plan image | ~15–20s | handoff narration: walk through what the pack will contain |
| /brief BUILD PACK — report (budget/materials/legal) | ~10–20s live (cached for demo) | one bridge sentence per section as it lands |

Tour caution: tours can straddle the 2-minute Live-session cap — start each tour early,
and the reconnect ritual must not kill the poll (it's client-side HTTP, it survives).

## Demo beats each mode enables

- **DESIGN MY HOME** (the whole show): one detailed prompt → a whole 3BHK designed room by
  room, in one consistent style the USER verified at every step, toured like a broker showing
  a flat, interruptible live, and closed with an architect-ready build pack. No camera-only
  competitor can show this.
- **FIX IT** (the judge-participation encore): a judge uploads a photo of THEIR OWN room →
  Asha compliments it, spots one opportunity, refurbishes it. Personal stakes = memorable.
- **SEE IT** (optional flourish): if the booth corner looks good, a quick camera pan +
  live refurbish proves the same loop works on reality in real time.

## Demo loop (whole-home, verify-at-each-step)

| t | Beat |
|---|---|
| 0:00 | Connect. Asha speaks first: greeting + the invitation ("Describe the home you're dreaming of..."). |
| 0:05 | User gives the detailed whole-home prompt (3BHK + gym + underground parking, modern techy). Asha acknowledges the scope, records it silently, asks her TWO questions (plot or flat? budget?). |
| 0:20 | `imagine_space` fires for the living room (hero area) — "let me sketch the living room first, the heart of the house." |
| 0:40 | 4 style concepts fill the rail (~18s) under three-beat narration. VERIFY: "which one feels like home?" User picks → style locked (silent note). |
| 0:50 | "Shall we do the gym next?" → yes → `imagine_space` with the chosen style → gym concepts (~18s) → VERIFY: user picks. |
| 1:15 | TOUR BY NAME: "show me the living room" → `generate_tour(area_name="living room")` — the wait IS the show: Asha narrates the coming camera move, keeps designing. (Name an undesigned room and the tool refuses — Asha offers to design it now.) |
| 1:50 | Tour plays on the central screen (~50s render); Asha narrates as HOME TOUR GUIDE — doorway, dining table under the LED wall, one feature per beat. |
| 2:10 | LIVE INTERRUPT mid-tour: "make it warmer" → `refine_design` (~15s) — "changing those walls now — I'll re-run the walkthrough when it's ready" → re-tour. |
| 2:45 | Re-tour plays (cached rooms replay instantly). User taps "▶ Tour whole home" → each locked room's tour plays sequentially, Asha narrating each room as its clip appears ("...and from the living room, into your kitchen"). |
| 3:20 | FINISH (user-driven — no auto-popup): user taps "✓ Finish home" → architect pack view opens; Asha may suggest once ("say 'prepare my architect pack' whenever you're ready"), and `compile_brief` fires only on the explicit ask → BUILD PACK on screen (plan ~15–20s, report ~10–20s). |

Optional FIX-IT encore (Q&A, untimed): judge uploads their own room photo → one compliment,
one opportunity, one refurbish on the rail.

Fallbacks: tour exceeds the session window → reconnect ritual, video pops on arrival ("there
it is — worth the wait?"). Tour fails → retry once, else pivot to `play_scene` evening clip
(cached, instant).

## TODO (web owner — not prompts-side)
`web/src/App.tsx` line ~44 has a hardcoded FALLBACK persona used only when the fetch of
`/prompts/persona.md` fails. It predates the whole-home flip — sync it with the live
persona.md (or it will silently revert Asha to the old single-room flow on fetch failure).
