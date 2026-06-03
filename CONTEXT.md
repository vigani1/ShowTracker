# ShowTracker Context

ShowTracker is a personal media tracking app for shows, anime, and movies. This context defines product language that should stay consistent across planning, UI copy, implementation, and ADRs. Product goals live in `docs/GOALS.md`; this file is only the vocabulary source of truth.

## Language

**Watchlist**:
The Home view of titles the user is actively meant to continue or review soon.
_Avoid_: Queue

**Library**:
The full collection of titles saved or tracked by the user across media types and statuses.
_Avoid_: Watchlist

**Backlog**:
Saved titles the user has not started watching yet.
_Avoid_: Queue

**Custom List**:
A user-created collection of selected titles.
_Avoid_: Watchlist, Library

**Remove from Library**:
The action that removes a title from the user's saved/tracked collection.
_Avoid_: Remove from Watchlist

**Media Type Filter**:
A single-choice filter that narrows titles by format, such as TV Shows, Anime, or Movies.
_Avoid_: Section, tab, multi-select filter

**Home Mode**:
The mutually exclusive Home state that chooses between the Watchlist and Schedule surfaces.
_Avoid_: Tab, filter

**Display Pair**:
A label and value shown together where the value only makes sense with that label.
_Avoid_: Count

**Shell Page**:
An authenticated app page inside the main ShowTracker shell.
_Avoid_: Public page, auth page

**Overlay Detail Route**:
A URL-addressable detail page opened above a preserved Shell Page state during in-app navigation.
_Avoid_: Drawer, modal page

## Relationships

- A **Library** contains all of the user's saved or tracked titles.
- A **Watchlist** is a focused Home surface derived from titles in the **Library**.
- A **Backlog** is a subset of the **Library** for titles the user has not started.
- A **Custom List** contains user-selected titles from the **Library**.
- **Remove from Library** removes the title from the **Library**, which also removes it from Home surfaces derived from the **Library**.
- A **Media Type Filter** can narrow the **Watchlist**, **Library**, or discovery results.
- A **Home Mode** selects which Home surface is shown before **Media Type Filter** narrows it.
- A **Display Pair** should update atomically when the label changes meaning.
- A non-tab **Shell Page** should provide an explicit back affordance.
- An **Overlay Detail Route** preserves the originating **Shell Page** when opened from inside the app, but direct/shared visits still render as a normal page.

## Example dialogue

> **Dev:** "Should a planned title appear in the **Watchlist**?"
> **Domain expert:** "Only when the Home experience needs to surface it. It still belongs in the **Library** even if it is not active in the **Watchlist**."

## Flagged ambiguities

- "Watchlist" can mean all saved titles in other apps, but in ShowTracker it remains the Home-focused continuation surface. Use **Library** for the full saved/tracked collection.
- The show-detail removal action should be phrased as **Remove from Library**, not "Remove from Watchlist", because it affects the broader saved/tracked collection.
- **Remove from Library** should ask for confirmation when the title has progress, tracking state, or custom-list membership that could be lost.
- `All / TV Shows / Anime / Movies` may be visually prominent, but it is still a **Media Type Filter**, not section navigation.
- A **Media Type Filter** always selects one value at a time; `All` resets the filter.
- `Watchlist / Schedule` is a **Home Mode** switch, not a filter and not a canonical tab.
- If a same-place **Display Pair** changes meaning, keep the previous label and value visible until the new pair is ready.
- Back buttons belong on authenticated non-tab **Shell Pages**, not on tab roots or auth/landing pages.
- "Drawer" and "modal" describe presentation details; use **Overlay Detail Route** for the navigation behavior that preserves source-page position while keeping a shareable URL.
