# Browser Automation Guide

How agents should use browser tooling in this repo during development.

## Default Tool Choice

The default browser automation tool for this repo is **Chrome DevTools MCP**. It provides direct access to Chrome's debugging protocol for inspecting elements, analyzing network requests, debugging JavaScript, and capturing screenshots.

Use Chrome DevTools MCP when:
- Debugging UI issues or visual regressions
- Inspecting DOM elements and styles
- Analyzing network requests and responses
- Debugging JavaScript execution
- Capturing screenshots for verification

Use `agent-browser` when:
- Performing multi-step user flows (login, signup, checkout)
- Testing navigation and routing
- Filling out forms programmatically
- Tasks that don't require DevTools inspection

## Setup Expectations

### Chrome DevTools MCP

Use this with a local Chrome DevTools MCP server configured in the agent and a Chrome instance available to connect to.

Preferred local setup:

- Chrome remote debugging enabled from `chrome://inspect/#remote-debugging`
- Chrome DevTools MCP configured with `--autoConnect`

This lets the agent attach to a real Chrome session for development inspection and debugging.

### What the user enabled in Chrome

This repo assumes the user may be using Chrome's newer built-in remote debugging flow:

- open `chrome://inspect/#remote-debugging`
- enable **Allow remote debugging for this browser instance**
- Chrome exposes a local DevTools server such as `127.0.0.1:9222`

This is different from the older workflow where the agent had to launch Chrome manually with flags like `--remote-debugging-port=9222`.

For this repo, if the user's Chrome already has remote debugging enabled in the browser UI, agents should prefer attaching to that running browser via Chrome DevTools MCP (`--autoConnect`) instead of assuming they need to relaunch Chrome manually.

### Why this matters

- it gives the agent access to the user's real logged-in Chrome session
- it is the preferred local setup for interactive UI debugging on ShowTracker
- it avoids unnecessary custom browser launches when the user's browser is already prepared for DevTools MCP

### Security note

This gives trusted local tools broad control over the browser, including page navigation, cookies, storage, and logged-in state. Use only with trusted agent tooling. If an isolated browser is needed, use a separate Chrome profile or a manually launched browser with a custom `--user-data-dir` instead of the user's main session.

### Fallback if auto-connect is not available

If Chrome DevTools MCP cannot attach to the user's running browser, fall back in this order:

1. connect to an explicit local browser URL if one is available
2. use a dedicated manually launched Chrome profile for debugging
3. use `agent-browser` if the task is flow-oriented and does not require DevTools-specific inspection

### `agent-browser`

Use the installed `agent-browser` skill and the local `agent-browser` CLI when the task is a browser workflow task rather than a DevTools debugging task.

### Use Chrome DevTools MCP first for UI development

This is the primary browser tool for ShowTracker when the goal is to inspect, debug, polish, and verify the web app during development.

Use it for:

- visual QA while changing screens and components
- checking layout, spacing, responsive behavior, and dark/light theme issues
- reading browser console errors and warnings
- inspecting failed network requests and API responses
- checking rendering or performance problems on specific routes
- taking screenshots and snapshots while iterating on a fix

Why it is the default here:

- ShowTracker is developed as a web target first for fast iteration
- Chrome DevTools MCP is best for interactive debugging and visual inspection
- it works well with the user's real Chrome session when remote debugging is enabled

### Use `agent-browser` for browser tasks and stateful flows

`agent-browser` is the default tool when the task is more like operating the app as a user than debugging it like a developer.

Use it for:

- login flows and auth checks
- guest-mode flows
- repeatable route walkthroughs
- browser tasks that need saved session state or persistent auth
- scraping or structured data collection from pages
- verifying long user journeys step-by-step with snapshots and refs

Why it is still important here:

- it has a strong snapshot/ref workflow for agents
- it is better than DevTools MCP for stateful task execution and browser automation routines
- the repo already includes the `agent-browser` skill and documented workflows

### Use `npm run ui:inspect` after visual changes

This is the repo's fast regression sweep, not the primary interactive debugging tool.

Use it for:

- route-by-route screenshot sweeps after UI changes
- desktop/mobile/mobile-window verification
- light/dark theme coverage
- quick proof that a layout change did not break major screens

Do not use it as the first tool when the agent needs to discover why a bug exists. Use Chrome DevTools MCP first, then use `ui:inspect` to confirm the result.

## Decision Rules

### Pick Chrome DevTools MCP when

- the task says debug, inspect, analyze, profile, or fix the UI
- the agent needs console, network, Lighthouse, layout, or DOM/CSS insight
- the agent is improving an existing screen and needs to understand what is wrong visually

### Pick `agent-browser` when

- the task says sign in, click through, complete a flow, gather data, or use the site like a user
- the task needs persistent session/auth handling
- the agent should walk a route sequence and verify results via snapshots

### Pick `ui:inspect` when

- the change is already implemented and needs a quick visual regression sweep
- the agent wants screenshots across multiple routes, themes, or device contexts

## Recommended Workflow For UI Bugs

1. Use Chrome DevTools MCP to inspect the broken route.
2. Fix the code.
3. Re-check the route in Chrome DevTools MCP.
4. Run `npm run ui:inspect:quick` or `npm run ui:inspect` if the change touches multiple screens.
5. Use `agent-browser` only if the fix affects login, guest mode, or a longer user flow.

## Recommended Workflow For Browser Tasks

1. Use `agent-browser` to open the route and snapshot the page.
2. Walk the flow with refs and wait conditions.
3. Save or reuse session state if the task involves auth.
4. Switch to Chrome DevTools MCP only if a browser-debugging issue appears.

## ShowTracker Notes

- The default local web URL is usually `http://localhost:8081`.
- If the task touches Convex-backed behavior, make sure the backend is running too.
- The user normally runs local servers themselves, so do not start or restart them unless required by the task or explicitly requested.
- Browser automation for this repo is for development verification and iteration, not formal end-to-end test authoring unless the user asks for that separately.
- The project includes both `agent-browser` and `chrome-devtools` skills; pick based on the decision rules above instead of defaulting to one tool for every browser task.
