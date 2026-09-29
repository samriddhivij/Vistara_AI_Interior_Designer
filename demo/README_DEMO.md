# demo/ — assets for the 90-second loop (all captured/generated TODAY, during the event)

`fixtures/` holds the booth-corner photos shot at T1 (12:00): `corner.jpg` is THE demo angle and
the test fixture for everything downstream (T3 shootout, /variants tuning, mock rail images), plus
two more angles (`corner_2.jpg`, `corner_3.jpg`) as backups if the primary angle misbehaves in
edits. `clips/` holds the pre-rendered Omni Flash videos produced by `server/scripts/prerender.py`
from the best T8-edited corner: `evening.mp4` (golden-hour pass, Clip A) and `monsoon.mp4` (rain +
lamps, Clip B, edit-chained on A via `previous_interaction_id`) — these exact filenames are what
the `play_scene` tool maps to per `docs/CONTRACT.md`, with the interaction ids recorded in
`clips/interactions.json` for re-firing failures. Finally, `fallback.mp4` (recorded at T16
rehearsals) is the screen capture of the best full run — the failure-ladder last resort, kept here
AND on the demo phone, narrated live if the hotspot or API dies.
