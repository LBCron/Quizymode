#!/usr/bin/env bash
# generate-user-guide-production.sh
# Captures desktop user-guide screenshots from the live production site and regenerates
# docs/user-guide/user-guide.md.
#
# No local servers required - screenshots are taken from https://www.quizymode.com
#
# Usage: ./scripts/generate-user-guide-production.sh
#
# Failed shots do not stop the run: the guide is still generated. The script then lists the failed shots
# and exits non-zero, so the failures are not silently ignored (AC 7.1.6).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$SCRIPT_DIR/_e2e-common.sh"

exit_code=1

test_prerequisites

echo "Capturing desktop screenshots from production..."
cd "$REPO_ROOT"
export PLAYWRIGHT_BASE_URL="https://www.quizymode.com"
mkdir -p "$REPO_ROOT/docs/user-guide/screenshots/user"
rm -f "$REPO_ROOT/docs/user-guide/screenshots/user"/*.png
rm -f "$REPO_ROOT/docs/user-guide/screenshots/failures.json"
capture_status=0
npx playwright test --project=screenshots || capture_status=$?

echo "Generating desktop user guide..."
node scripts/generate-user-guide.js --guide desktop
exit_code=$?

echo "Checking capture results..."
report_status=0
node scripts/evaluate-user-guide-capture.js --mode report --viewports desktop || report_status=$?

if [[ $exit_code -eq 0 && $capture_status -ne 0 ]]; then
    echo "Playwright exited with status $capture_status. See the output above." >&2
    exit_code=$capture_status
fi
if [[ $exit_code -eq 0 && $report_status -ne 0 ]]; then
    echo "Some desktop screenshots failed. The guide was generated with 'unavailable' cards for them." >&2
    exit_code=$report_status
fi

guide_file="$REPO_ROOT/docs/user-guide/user-guide.md"
if [[ -f "$guide_file" ]]; then
    echo ""
    echo "Desktop user guide updated:"
    echo "  $guide_file"
fi

exit $exit_code
