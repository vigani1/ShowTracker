# Testing Guide for ShowTracker

This document provides instructions for running automated tests using the browser automation tool.

## Prerequisites

1. **Start the Expo dev server:**
   ```bash
   npx expo start --web
   ```

2. **Start Convex dev server (if testing backend features):**
   ```bash
   npx convex dev
   ```

## Test Credentials

Test credentials are stored in `.env.test` (do not commit this file).
Copy `.env.example` to `.env.test` and fill in your test credentials:

```
TEST_EMAIL=your-test-email@example.com
TEST_PASSWORD=your-test-password
```

## Using the Browser Automation Tool

### Basic Commands

```bash
# Open a page
agent-browser open http://localhost:8081

# Wait for page to load
agent-browser wait --load networkidle

# Get interactive elements
agent-browser snapshot -i

# Click an element
agent-browser click @e1

# Fill a textbox
agent-browser fill @e1 "text"

# Take a screenshot
agent-browser screenshot

# Get current URL
agent-browser get url

# Close browser
agent-browser close
```

### Login Flow

```bash
# Navigate to login
agent-browser open http://localhost:8081/login
agent-browser wait --load networkidle
agent-browser snapshot -i

# Fill credentials (use values from .env.test)
agent-browser fill @e1 "$TEST_EMAIL"  # Email
agent-browser fill @e2 "$TEST_PASSWORD"        # Password

# Submit (press Enter or find Sign In button)
agent-browser press Enter
# OR
agent-browser find text "Sign In" click

# Wait for redirect
agent-browser wait --url "**/home"
```

### Guest Login (Alternative)

If password login doesn't work, use guest login:
```bash
agent-browser open http://localhost:8081/login
agent-browser find text "Continue as Guest" click
agent-browser wait --url "**/home"
```

## Testing Specific Features

### Test Show Detail Page (Mobile Spacing)

1. Navigate to a show:
   ```bash
   agent-browser open http://localhost:8081/show/tmdb:tv:1399
   agent-browser wait --load networkidle
   agent-browser screenshot
   ```

2. Verify:
   - Content is not too narrow on mobile
   - Padding is consistent with create list screen

### Test Custom List Navigation

1. Go to library:
   ```bash
   agent-browser open http://localhost:8081/library
   agent-browser wait --load networkidle
   agent-browser screenshot
   ```

2. Click on a show in a custom list

3. Verify the show detail page loads without "Invalid show ID" error

### Test Edit List Header

1. Navigate to a custom list detail:
   ```bash
   agent-browser open http://localhost:8081/lists
   ```

2. Click the edit button (pencil icon)

3. Verify the edit screen shows "Edit List" header with PageIntro component

### Test Anime Navigation

```bash
# Test anime format
agent-browser open http://localhost:8081/show/anilist:anime:21
agent-browser wait --load networkidle
agent-browser screenshot
```

## Test Script

A test script is available at `scripts/test-app.sh`:

```bash
# Run all tests
./scripts/test-app.sh all

# Run specific tests
./scripts/test-app.sh login
./scripts/test-app.sh show-detail
./scripts/test-app.sh list
./scripts/test-app.sh edit-list
```

Note: The script may need adjustments based on current app structure.

## Viewing Screenshots

Screenshots are saved to:
```
C:\Users\<username>\.agent-browser\tmp\screenshots\
```

## Troubleshooting

### "Daemon failed to start" error

The agent-browser daemon might not be running. Try:
```bash
agent-browser open http://localhost:8081
```

### Login not working

- Try guest login instead: `agent-browser find text "Continue as Guest" click`
- Check if app is running: `curl http://localhost:8081`

### Elements not found

After navigation, always re-snapshot:
```bash
agent-browser click @e5
agent-browser snapshot -i  # Get new refs
agent-browser click @e1   # Use new refs
```

## Running TypeScript and Lint Checks

Before testing, always verify code quality:

```bash
# TypeScript type check
npx tsc --noEmit

# ESLint
npx expo lint

# Convex functions
npx convex dev --once
```

## File Locations

- Test credentials: `.env.test`
- Test script: `scripts/test-app.sh`
- Screenshots: `C:\Users\<username>\.agent-browser\tmp\screenshots\`
