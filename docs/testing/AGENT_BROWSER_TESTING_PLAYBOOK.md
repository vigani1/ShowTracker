# Agent Browser Testing Playbook

Practical guide for agents testing ShowTracker web UX with `agent-browser`.

Use this when validating feature work, regressions, or release readiness.

---

## Why this exists

`agent-browser` is powerful, but automation quality drops when agents:

- test only happy paths
- skip complete user flows (open -> act -> verify)
- reuse stale element refs
- wait on the wrong condition and time out
- stop after a click without checking the resulting state

This playbook standardizes the testing approach so agents produce reliable, repeatable QA.

---

## Non-negotiable rules

1. **Validate outcomes, not clicks**
   - Every interaction must be followed by an assertion.
   - Example: after `Add to Watchlist`, verify button/state changed and feature appears in Home/Library.

2. **Re-snapshot after DOM changes**
   - Refs like `@e1` are invalid after navigation, modal open/close, tab change, list rerender.
   - Always run `agent-browser snapshot -i` again before next action.

3. **Use deterministic waits**
   - Prefer `wait @element` or `wait --url "**/route"`.
   - Use `wait --load networkidle` sparingly (can hang with realtime traffic).

4. **Cover full user flow loops**
   - Not just “open screen and click button”.
   - Run create -> observe -> update -> observe -> undo/remove when possible.

5. **Do not start app/backend servers unless user asked**
   - Assume the user runs `expo`/`convex` instances.
   - If unavailable, report blocker clearly.

---

## Standard execution loop

Use this loop for every scenario:

1. Navigate to target page.
2. Snapshot interactive elements.
3. Perform one interaction.
4. Re-snapshot.
5. Assert expected UI/state change.
6. Capture screenshot for evidence (recommended for major checkpoints).

Minimal pattern:

```bash
agent-browser open http://localhost:8081/discover
agent-browser snapshot -i
agent-browser click @e12
agent-browser snapshot -i
agent-browser get text @e7
agent-browser screenshot --full
```

---

## Command patterns that work best

### 1) Snapshot strategy

- Use `agent-browser snapshot -i` as default.
- If clickable element is missing (custom div/button styles), use `agent-browser snapshot -i -C`.
- After modals/tabs/navigation: re-snapshot immediately.

### 2) Locator strategy (preferred order)

1. Element refs from latest snapshot (`@eN`)
2. Semantic finders (`find text`, `find role`, `find label`)
3. Scoped snapshot (`snapshot -i -s "#container"`) for dense UIs

### 3) Wait strategy

Preferred:

- `agent-browser wait @eN`
- `agent-browser wait --url "**/show/**"`
- short explicit waits (`agent-browser wait 300`) for animations only

Avoid overusing:

- `wait --load networkidle` on pages with ongoing realtime/subscriptions

### 4) Authentication reuse

If testing multiple flows:

```bash
agent-browser state save .tmp-auth.json
# later
agent-browser state load .tmp-auth.json
```

This reduces flaky repeated login steps.

---

## ShowTracker test scope

Run **Core Smoke** for every UI-affecting PR.
Run **Targeted Deep Tests** for touched areas.

### Core smoke suite (required)

1. **Home watchlist renders**
   - Open Home, verify tracked cards render and no crash.
2. **Home Upcoming controls**
   - Toggle to Upcoming, verify `Load Earlier`, `Load Later`, `Jump to Today` behavior.
3. **Discover loads + navigation works**
   - Open Discover, open one title detail, return back.
4. **Search works**
   - Search a known title, open detail from result.
5. **Recommendations loads**
   - Open For You; verify tabs (`All/TV/Anime/Movies`) render content or valid empty states.
6. **Library filters**
   - Switch media tabs and status filters; ensure list updates and no UI errors.
7. **Profile loads**
   - Verify profile hero + stats/rails eventually load (supports deferred loading).
8. **Show detail critical actions**
   - Toggle watch state for at least one episode/movie action and verify state updates.

### Targeted deep tests by area

#### Auth (`app/(auth)/*`)

- Login success path
- Login failure messaging
- Register success path
- Sign out from Profile

#### Home (`app/(tabs)/home/index.tsx`)

- Watchlist grouping and ordering
- Anime franchise single-entry behavior
- Upcoming scroll stability (no index/layout crashes)
- Date-range controls preserve state

#### Discover/Search/Recommendations

- Pagination/load-more behavior
- Already tracked titles marked/excluded correctly
- Cross-tab consistency (TV/Anime/Movie)

#### Show detail (`app/show/[id].tsx`)

- Add/remove watchlist
- Status change (`watching`, `paused`, `completed`, etc.)
- Episode toggle watched/unwatched
- Season batch actions (`Mark All`, unwatch)
- Movie watched toggle
- Anime completion prompt actions
- Franchise settings modal (inherit/core/all)

#### Library (`app/(tabs)/library/index.tsx`)

- Media tab filters + status chip counts
- Empty state and non-empty state correctness
- Navigation to show detail from list

#### Lists (`app/list/*`)

- Create list
- Add show to list
- Reorder/remove items
- Delete list and back navigation behavior

#### Profile (`app/(tabs)/profile.tsx`)

- Profile edit modal save/cancel
- Anime global settings modal save + close
- Stats section toggle variants
- Rails scrolling and navigation

#### Import (`app/import.tsx`)

- Upload/paste entry points render
- Validation and error messaging for invalid payload

---

## Flow completeness checklist (per tested feature)

For each feature touched in a PR, verify at least:

- **Entry**: user can discover/open feature
- **Primary action**: action succeeds in UI
- **Persistence**: refresh or navigate away/back keeps state
- **Cross-screen propagation**: change appears where expected (Home/Library/Profile)
- **Negative/edge path**: invalid input, empty state, or disabled action behaves safely

If any checkbox is skipped, explicitly report it as untested.

---

## Common failure modes and fixes

| Symptom | Likely Cause | Fix |
|---|---|---|
| Click fails with missing ref | stale `@eN` after rerender | `snapshot -i` and use new ref |
| Element not found in snapshot | custom clickable surface | use `snapshot -i -C` or semantic `find` |
| Wait hangs forever | waiting on `networkidle` with active realtime traffic | wait for URL or specific element |
| Wrong element clicked in dense layouts | ambiguous ref selection | use scoped snapshot (`-s`) or semantic locator |
| Action appears successful but data not changed | no post-action assertion | verify text/state, then cross-screen confirm |
| Modal interactions flaky | animation timing | short `wait 200-400`, then re-snapshot |
| Infinite scroll not triggering | viewport not near threshold | explicit `scroll down` loops + snapshot checks |
| “Works once” then breaks later in same run | accumulated app state | reset via deterministic route and/or reload page |

---

## Anti-patterns to avoid

- Running long chains of clicks without assertions
- Reusing refs after page transitions
- Verifying only one screen when action should affect multiple screens
- Reporting “pass” based on absence of visible errors alone
- Ignoring console/runtime errors surfaced by app error boundaries

---

## Suggested evidence format in final report

When reporting to user, include:

1. **Tested flows** (bullet list with route + outcome)
2. **Failures** (what failed, exact step, observed behavior)
3. **Risk gaps** (what was not tested)
4. **Artifacts** (screenshot names/locations if captured)

Example:

- `Home -> Upcoming -> Jump to Today`: pass, index stable, no crash
- `Show detail anime completion prompt`: pass, “Open Next Season” navigates correctly
- `Import invalid JSON`: fail, missing inline error state

---

## Path-to-test mapping (coverage guardrail)

Use changed files to decide minimum required flows.

| Changed path prefix | Required test flows |
|---|---|
| `app/(tabs)/home/` | Home watchlist + Upcoming controls + cross-nav to show detail |
| `app/(tabs)/discover/` | Discover load, pagination, open detail, tracked indicators |
| `app/(tabs)/recommendations` | For You tab switching, exclusion behavior, open detail |
| `app/(tabs)/search` | Query, result rendering, open detail |
| `app/show/` | Watch actions, status changes, franchise/completion modals |
| `app/(tabs)/library/` | Media/status filtering, counts, open detail |
| `app/(tabs)/profile` | Profile load, stats/rails, edit/settings modals, sign out |
| `app/list/` | Create/edit/delete list and item management |
| `app/import` | Import UX, validation, error handling |
| `convex/shows.ts` | End-to-end verification of watch/tracking behavior in UI |
| `convex/schedule.ts` | Upcoming rendering, date controls, show linking |

---

## Fast PR strategy (recommended)

If PR is medium/large, use this order:

1. Run Core smoke suite first.
2. Run targeted deep tests based on changed files.
3. Re-test one end-to-end golden path:
   - Discover -> Open show -> Add to watchlist -> Mark watched -> Confirm Home/Library/Profile updates.
4. Report passes/fails/gaps explicitly.

This catches most regressions with the least wasted motion.
