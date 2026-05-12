# ADR 0001: Overlay Detail Routes for Show Details

## Status

Accepted

## Context

Discovery, For You, Library, Search, Home, Profile, and List Detail all route into the same show detail screen. These source pages are scrollable and often expensive to reconstruct because they contain filters, loaded result pages, rails, or personalized queries.

Users need to open a title, add or inspect it, and return to the exact position they came from. At the same time, `/show/[id]` must remain a shareable URL that works when opened directly.

## Decision

Use an **Overlay Detail Route** for `/show/[id]` when the route is opened from inside an existing shell stack. The root stack presents the show route as a transparent modal, and the show screen renders inside an app-owned overlay frame only when the route is dismissible.

Direct/shared visits to `/show/[id]` render the same show detail screen as a normal full page because there is no meaningful source page behind the route.

## Consequences

- Source Shell Pages remain mounted underneath in-app show detail navigation, preserving scroll position, filters, loaded pages, and local UI state.
- URLs stay canonical and shareable because the detail route remains `/show/[id]`.
- The show detail screen must distinguish dismissible in-app overlays from direct page loads and choose close vs back affordances accordingly.
- Future detail routes should only use this pattern when returning to a preserved source page is more important than replacing the current page.

## Alternatives Considered

- Full-page push for show details: simplest, but loses or risks rebuilding source page scroll state when returning.
- Query-param overlays on source pages: preserves state, but weakens canonical shared URLs and duplicates detail-route logic across sources.
- Always render `/show/[id]` over a default Shell Page: keeps overlay visuals, but makes shared links surprising and may show unrelated content behind the detail.
