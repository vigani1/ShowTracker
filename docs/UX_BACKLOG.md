# UX Backlog

Loose notes for future UX fixes and experiments. These are intentionally not implementation specs yet; refine each item before building.

## Navigation, Tabs, and Filters

### Rework in-page tabs

- Problem: Tabs inside the home page and other screens may not feel right visually or functionally.
- Concern: Filters and tabs currently look too similar, which can make the UI harder to understand.
- Ideas:
  - Explore alternatives to traditional tabs for home-page sections.
  - Make filters visually and behaviorally distinct from section navigation.
  - Consider swipe gestures to move between adjacent tab/section views, especially on mobile.
- Open questions:
  - Which screens need tab-like navigation versus simple filters?
  - Should swipe navigation be enabled only on mobile, or also web trackpads?

## Loading and Counts

### Preserve previous counts while refreshing

- Problem: Counts in the top bar and possibly other places briefly drop to `0` while data is changing/loading.
- Idea: Keep showing the previous known value until a fresh value is available.
- Goal: Avoid odd visual jumps and prevent users from thinking the real count became zero.
- Open questions:
  - Which count surfaces currently flicker to `0`?
  - Should stale counts show a subtle loading state, or just remain unchanged?

## Page Headers and Back Navigation

### Add back buttons where needed

- Problem: Some detail pages rely on slide gestures or system/browser navigation, and the top header can feel empty.
- Idea: Add explicit back buttons to pages that naturally need a way back.
- Candidate screens:
  - Show detail
  - Season view
  - Episode view
- Goal: Improve navigation clarity and make sparse headers more useful.

## Show Actions and Header Controls

### Compact show status controls

- Problem: Show status changes take too much space.
- Idea: Move status actions into compact icons near the page header.
- Related actions to evaluate:
  - Status change
  - Mark all watched
  - Add to list
- Notes:
  - Hide "add to list" when it is not needed or not available.
  - Test whether icon-only actions are clear enough, possibly with labels/tooltips where appropriate.

## Episodes

### Improve collapse and expand icon

- Problem: The current collapse/uncollapse icon for episodes could be clearer.
- Idea: Try a better affordance for expanded and collapsed episode groups.
- Open questions:
  - Should the icon communicate direction, state, or action?
  - Should the whole row be tappable/clickable?

### Swipe episode to change status

- Idea: Add mobile swipe actions on episodes to change watch status.
- Goal: Make episode tracking faster on mobile.
- Open questions:
  - What swipe directions map to which actions?
  - Should swipe reveal actions, immediately toggle status, or ask for confirmation on destructive changes?
  - How should this behave on web?
