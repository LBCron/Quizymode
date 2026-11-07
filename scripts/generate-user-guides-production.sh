#!/usr/bin/env bash
# generate-user-guides-production.sh
# Captures desktop and mobile user-guide screenshots from the live production site and regenerates
# docs/user-guide/user-guide.md and docs/user-guide/user-guide.mobile.md.
#
# No local servers required - screenshots are taken from https://www.quizymode.com
#
# Usage: ./scripts/generate-user-guides-production.sh
#
# Failed shots do not stop the run: the guides are still generated. The script then lists the failed shots
# and exits non-zero, so the failures are not silently ignored (AC 7.1.6).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$SCRIPT_DIR/_e2e-common.sh"

exit_code=1

test_prerequisites

echo "Capturing desktop and mobile screenshots from production..."
cd "$REPO_ROOT"
export PLAYWRIGHT_BASE_URL="https://www.quizymode.com"
for theme in dark light; do
  for viewport in desktop mobile; do
    mkdir -p "$REPO_ROOT/docs/user-guide/screenshots/$theme/$viewport"
    rm -f "$REPO_ROOT/docs/user-guide/screenshots/$theme/$viewport"/*.png
  done
done
rm -f "$REPO_ROOT/docs/user-guide/screenshots/failures.json"
capture_status=0
npx playwright test --project=screenshots --project=screenshots-mobile || capture_status=$?

echo "Generating desktop and mobile user guides..."
node scripts/generate-user-guide.js --all
exit_code=$?

echo "Checking capture results..."
report_status=0
node scripts/evaluate-user-guide-capture.js --mode report --viewports desktop,mobile || report_status=$?

if [[ $exit_code -eq 0 && $capture_status -ne 0 ]]; then
    echo "Playwright exited with status $capture_status. See the output above." >&2
    exit_code=$capture_status
fi
if [[ $exit_code -eq 0 && $report_status -ne 0 ]]; then
    echo "Some screenshots failed. The guides were generated with 'unavailable' cards for them." >&2
    exit_code=$report_status
fi

for guide_file in \
    "$REPO_ROOT/docs/user-guide/user-guide.md" \
    "$REPO_ROOT/docs/user-guide/user-guide.mobile.md"; do
    if [[ -f "$guide_file" ]]; then
        echo ""
        echo "User guide updated:"
        echo "  $guide_file"
    fi
done

exit $exit_code
