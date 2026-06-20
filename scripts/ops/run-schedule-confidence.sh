#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${SHOWTRACKER_APP_DIR:-/opt/showtracker}"
BRANCH="${SHOWTRACKER_RECONCILER_BRANCH:-main}"
LOCK_FILE="${SHOWTRACKER_RECONCILER_LOCK:-/tmp/showtracker-schedule-confidence.lock}"

cd "$APP_DIR"

(
  flock -n 9 || {
    echo "Another schedule-confidence run is active"
    exit 75
  }

  if git fetch origin "$BRANCH" && git reset --hard "origin/$BRANCH"; then
    echo "Updated checkout to origin/$BRANCH"
  else
    git_status=$?
    echo "Warning: git update failed with status $git_status; continuing with the current checkout." >&2
    if [ "${SHOWTRACKER_RECONCILER_REQUIRE_GIT_UPDATE:-0}" = "1" ]; then
      exit "$git_status"
    fi
    git rev-parse --verify HEAD >/dev/null
    echo "Current checkout: $(git rev-parse --short HEAD)"
  fi

  npm run schedule-confidence:import
  npm run schedule-confidence:reconcile:providers
  npm run schedule-confidence:audit
  npm run schedule-confidence:apply -- --batch-size 1
) 9>"$LOCK_FILE"
