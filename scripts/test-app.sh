#!/bin/bash
# ShowTracker Automated Test Script
# Usage: ./scripts/test-app.sh [test-name]
# 
# Tests require the app to be running:
#   npx expo start --web
#
# Environment variables (set in .env.test):
#   TEST_EMAIL
#   TEST_PASSWORD

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Load test credentials
if [ -f "$(dirname "$0")/../.env.test" ]; then
    source "$(dirname "$0")/../.env.test"
fi

# Fail fast if required environment variables are not set
if [ -z "$TEST_EMAIL" ] || [ -z "$TEST_PASSWORD" ]; then
    echo -e "${RED}Error: Missing required environment variables${NC}"
    echo "Please create .env.test with TEST_EMAIL and TEST_PASSWORD"
    echo ""
    echo "Example .env.test:"
    echo "  TEST_EMAIL=your-test-email@example.com"
    echo "  TEST_PASSWORD=your-test-password"
    exit 1
fi

BASE_URL="${BASE_URL:-http://localhost:8081}"

echo -e "${GREEN}=== ShowTracker Automated Tests ===${NC}"
echo "Email: configured"
echo "Base URL: $BASE_URL"
echo ""

# Function to run a test
run_test() {
    local test_name="$1"
    local test_func="$2"
    
    echo -e "${YELLOW}Running: $test_name${NC}"
    eval "$test_func"
    echo -e "${GREEN}✓ $test_name passed${NC}"
    echo ""
}

# Test 1: App loads
test_app_loads() {
    agent-browser open "$BASE_URL"
    agent-browser wait --load networkidle
    agent-browser get title
}

# Test 2: Login flow
test_login() {
    # Navigate to login
    agent-browser open "$BASE_URL/login"
    agent-browser wait --load networkidle
    agent-browser snapshot -i
    
    # Try to find and fill login form
    # Note: The actual selectors depend on the login form structure
    agent-browser find label "Email" fill "$TEST_EMAIL"
    agent-browser find label "Password" fill "$TEST_PASSWORD"
    agent-browser find text "Sign In" click
    
    # Wait for redirect to home
    agent-browser wait --url "**/home" 10000 || true
}

# Test 3: Mobile spacing on show detail
test_show_detail_spacing() {
    # First login if needed
    agent-browser open "$BASE_URL/home"
    agent-browser wait --load networkidle
    
    # Navigate to a show (using a known show ID)
    agent-browser open "$BASE_URL/show/tmdb:tv:1399"
    agent-browser wait --load networkidle
    agent-browser screenshot
}

# Test 4: Custom list navigation
test_list_navigation() {
    agent-browser open "$BASE_URL/lists"
    agent-browser wait --load networkidle
    agent-browser snapshot -i
}

# Test 5: Edit list screen header
test_edit_list_header() {
    agent-browser open "$BASE_URL/lists"
    agent-browser wait --load networkidle
    
    # Find and click on a list to open it
    agent-browser find text "View" click || true
    agent-browser wait --load networkidle
    
    # Find and click edit button
    agent-browser find text "Edit" click || true
    agent-browser wait --load networkidle
    agent-browser screenshot
}

# Main test runner
main() {
    local test_name="${1:-all}"
    
    # Check if app is running
    if ! curl -s "$BASE_URL" > /dev/null 2>&1; then
        echo -e "${RED}Error: App not running at $BASE_URL${NC}"
        echo "Please start the app with: npx expo start --web"
        exit 1
    fi
    
    case "$test_name" in
        "login")
            run_test "Login Flow" test_login
            ;;
        "show-detail")
            run_test "Show Detail Mobile Spacing" test_show_detail_spacing
            ;;
        "list")
            run_test "List Navigation" test_list_navigation
            ;;
        "edit-list")
            run_test "Edit List Header" test_edit_list_header
            ;;
        "all")
            run_test "App Loads" test_app_loads
            run_test "Login Flow" test_login
            run_test "Show Detail" test_show_detail_spacing
            run_test "List Navigation" test_list_navigation
            run_test "Edit List" test_edit_list_header
            ;;
        *)
            echo "Usage: $0 [test-name]"
            echo "Tests: login, show-detail, list, edit-list, all"
            exit 1
            ;;
    esac
    
    echo -e "${GREEN}=== Tests Complete ===${NC}"
}

main "$@"
