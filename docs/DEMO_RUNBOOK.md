# DEMO_RUNBOOK.md — the 90-second loop, booth protocol, fallbacks, submission

## Physical setup (arrange during P3, while builds run)
- The booth corner IS the demo room. Props: one chair, one lamp, ideally a window in frame.
  Choose the corner at 12:00 (T1 photographs it) and never change it.
- Phone on Anupam's hotspot. Laptop (running server/) on the same hotspot. Venue wifi is for
  coding only. Phone at 70%+ battery, DND on, brightness max.
- Between judges: kill and restart the Live session fresh EVERY time (short sessions never degrade).

## THE 90-SECOND LOOP (booth version — runs 8–12 times, 5:00–6:45)

| t | Beat | Say / Do | What judges see |
|---|---|---|---|
| 0:00 | Speaks first | Tap start, point phone at corner, say NOTHING | Designer greets and comments on the visible room unprompted |
| 0:10 | Interruption | Hand judge the phone: "interrupt it whenever you want" | Judge talks over it; it stops mid-word and pivots |
| 0:25 | The seam | Steer: "I'm bored of this corner, something warmer?" | Brain feed shows 🔧 generate_variants firing UNPROMPTED; 4 tiles appear, fill in ~4s each |
| 0:50 | Iterate | React to a variant by voice ("less wood, more plants") | Rail refreshes; conversation never stops |
| 1:00 | Climax | "Show me a Sunday evening here" | Omni clip: golden hour crossing THIS corner. Then "now monsoon" → rain + lamps |
| 1:20 | The brief | "Send this to my architect" | 🔧 compile_brief fires → ₹ budget with vendor links + society-NOC checklist on screen |
| 1:35 | Close | Point at brain feed | "No prompt box anywhere. Gemini is the event loop — NB2 and Omni are its hands. Built today, repo's public." |

**HARD CONSTRAINT: Live audio+video sessions cap at 2 MINUTES.** The loop above is timed to fit.
If a session dies mid-loop, the reconnect is a rehearsed ritual — "let me call her back" — 10 seconds,
looks intentional. Practice it until it IS intentional.
**Price questions:** if a judge asks "how much would that cost?", the designer answers live via
google_search grounding — always say "estimate". Never promise exact prices (grounding gives
citations, not a price feed).
**If T19 splat shipped:** after the brief beat, hand the judge the laptop: "and here's this exact
corner, walkable in 3D — reconstructed from a 90-second phone video this afternoon, open-source
pipeline." Pure appendix; skip without comment if it's not ready.

Roles: driver narrates + steers; second dev watches brain feed, answers architecture questions
(model IDs, what's cached vs live — ANSWER HONESTLY: "the video clips were generated with Omni
earlier today from this exact corner; everything else is live right now").

## Stage version (7:00 finals, 3 minutes) = booth loop + two inserts
- After 0:50 insert the constraint beat (if T15b shipped): "We have a toddler, budget's fifty
  thousand" → 📝 notebook logs both → next variants visibly obey (rounded edges, ₹-realistic).
- After the climax insert the language beat (if T13 shipped): switch to Hindi/Kannada mid-sentence.
- Whitespace line (memorize — verified by research, judges can check): "Every design tool on the
  market takes a photo or a LiDAR scan. Nobody takes a live video tour, nobody does voice, nobody
  does Indian rupee budgets, nobody touches society NOCs. Vistara does all four."
- Close with roadmap ONE sentence: "Record your whole home once — Gemini's video understanding
  holds an hour of tour — and every room, every budget, every approval is one conversation away."

## Failure ladder (decide in advance, never improvise on stage)
1. Live session drops → restart session (10s ritual: "let me call her back"). Practiced, looks natural.
2. Variants come back ugly → "let's try a different direction" → steer to a safe-envelope edit.
3. Tool call doesn't fire → say the magic phrase that always triggers it (find it in T12 rehearsals;
   usually an explicit "show me options for...").
4. Hotspot/API dead → fallback.mp4 on the phone, narrated live: "This is this corner, recorded
   40 minutes ago — I'll walk you through what's happening under the hood." Confident, not apologetic.

## Submission checklist (T18, done by 4:45)
- [ ] `git push` final; tag `demo-freeze` pushed
- [ ] Repo PUBLIC — verified in incognito window
- [ ] README: pitch, arch diagram, model IDs, demo video link, "built today vs starter" disclosure, team names
- [ ] demo video uploaded (unlisted) AND fallback.mp4 on the phone locally
- [ ] Event submission form submitted — screenshot the confirmation
- [ ] Both devs can recite: repo URL, the three model IDs, what's live vs cached

## The pitch sentence (memorize, both devs)
"Redesigning a room today means typing prompts at a photo. Vistara deletes the prompt box: you walk
your room on a video call with a designer who sees what you see, interrupts and gets interrupted,
and redesigns the room at the speed of the argument — one Live API session driving Nano Banana
and Omni Flash as its hands."
