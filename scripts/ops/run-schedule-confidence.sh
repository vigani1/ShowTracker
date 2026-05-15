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

  git fetch origin "$BRANCH"
  git reset --hard "origin/$BRANCH"

  npm run schedule-confidence:import
  npm run schedule-confidence:reconcile:providers
  npm run schedule-confidence:audit
  npm run schedule-confidence:apply
) 9>"$LOCK_FILE"
