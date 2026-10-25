---
name: design-review
description: Screenshot Fynd's screens in the iOS Simulator, critique them against DESIGN.md and strong mobile design practice, then fix and re-verify. Use when Roy asks to review, polish, or improve the app's UI or a specific screen.
---

# Design review

You can't judge a UI from code alone. Look at real screenshots, critique, fix, and look again.

## 0. Preconditions

1. Read `DESIGN.md` in full. It is binding and outranks any other design skill or taste: if a general design idea conflicts with it, DESIGN.md wins.
2. Simulator running: `xcrun simctl list devices booted`. If none is booted, ask Roy to start the app (`cd apps/mobile && pnpm ios`) and stop.
3. Data: screens with no listings tell you nothing. If the local DB has few or no active listings with real photos, stop and offer to write a seed script (realistic second-hand items, varied photo aspect ratios, long and short titles, several sellers).

## 1. Capture

Save to `apps/mobile/.design-shots/<round>/` (gitignored). `<round>` is `before` or `after-N`.

Open a screen by deep link, wait, screenshot:

```
xcrun simctl openurl booted "exp://127.0.0.1:8081/--/<route>"   # Expo Go
# dev build instead: xcrun simctl openurl booted "fynd://<route>"
sleep 3
xcrun simctl io booted screenshot apps/mobile/.design-shots/<round>/<name>-light.png
```

Routes (route groups like `(app)`/`(tabs)` are dropped from URLs): `/` (home feed), `/explore`, `/inbox`, `/profile`, `/profile/my-listings`, `/profile/saved`, `/profile/edit`, `/sell`, `/listing/<id>`, `/seller/<id>`, `/conversation/<id>`, `/follows/<id>`.
Get real ids from the local DB, e.g. `psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -c "select id from public.listings where status='active' limit 3"`.

If Roy named one screen, capture only that one. For each captured screen:
- Light and dark: `xcrun simctl ui booted appearance dark` (then `light` to restore).
- Large text on key screens: `xcrun simctl ui booted content_size accessibility-extra-large`, then `xcrun simctl ui booted content_size large` to restore.
- Where you can reach them, the empty, loading and error states too.

Then **Read every screenshot** before writing anything.

## 2. Critique

Judge each screen against this rubric, citing DESIGN.md sections:
- **Photography is the hero** (§1). Does chrome compete with the photo?
- **Hierarchy**: does the eye land on the right thing first (for the feed, the §14.1 tiers)? Is there exactly one obvious primary action?
- **Restraint**: count the elements. Remove anything that doesn't earn its place.
- **Rhythm and alignment**: consistent spacing scale (§6), shared edges, nothing a few pixels off.
- **Typography**: scale and weights per §5; no orphaned single words in titles; long titles truncate gracefully.
- **Consistency**: the same component looks and behaves the same on every screen.
- **Warm and human copy** in empty states, errors and buttons (§1).
- **Dark mode and large text**: nothing clipped, overlapping, or illegible.
- **Accessibility** (§12): 44pt targets, contrast, no color-only state.
- **Code check**: grep the screen files for raw hex colors, magic numbers, and primitive ramp values (§15.1).

Write the findings to `docs/design-reviews/<YYYY-MM-DD>.md`: per screen, ranked **High / Medium / Low**, each with the screenshot filename, what's wrong, why (DESIGN.md section or principle), and the concrete fix.

## 3. Fix

- Apply High and Medium fixes that stay inside the existing system (tokens, variants, primitives).
- Anything that changes the system (a new token, variant or primitive, or a palette or type change) needs a DESIGN.md update first (§15.3). Propose it to Roy and wait.
- Never resolve a DESIGN.md [OPEN] item. List it as a question for Roy.
- One commit per screen or theme: `style(<screen>): <what improved>`. Run the `verify` skill before each commit.

## 4. Verify

Re-capture the changed screens into `after-N`, Read them, and compare them side by side with `before`. If a fix made things worse or caused a regression, revert it. Finish by giving Roy a short before/after summary per screen, plus the open questions.
