# generate-user-guide-production.ps1
# Captures desktop user-guide screenshots from the live production site and regenerates
# docs/user-guide/user-guide.md.
#
# No local servers required - screenshots are taken from https://www.quizymode.com
#
# Usage: .\scripts\generate-user-guide-production.ps1
#
# Failed shots do not stop the run: the guide is still generated. The script then lists the failed shots
# and exits non-zero, so the failures are not silently ignored (AC 7.1.6).

. "$PSScriptRoot\_e2e-common.ps1"

$exitCode = 1

try {
    Test-Prerequisites

    $screenshotDir = Join-Path $RepoRoot "docs\user-guide\screenshots\user"
    if (Test-Path $screenshotDir) {
        Write-Host "Clearing previous desktop screenshots..." -ForegroundColor Cyan
        Remove-Item -LiteralPath (Join-Path $screenshotDir "*.png") -Force -ErrorAction SilentlyContinue
    }
    $reportFile = Join-Path $RepoRoot "docs\user-guide\screenshots\failures.json"
    if (Test-Path $reportFile) {
        Remove-Item -LiteralPath $reportFile -Force
    }

    Write-Host "Capturing desktop screenshots from production..." -ForegroundColor Cyan
    Push-Location $RepoRoot
    $env:PLAYWRIGHT_BASE_URL = "https://www.quizymode.com"
    npx playwright test --project=screenshots
    $captureStatus = $LASTEXITCODE

    Write-Host "Generating desktop user guide..." -ForegroundColor Cyan
    node scripts/generate-user-guide.js --guide desktop
    $exitCode = $LASTEXITCODE

    Write-Host "Checking capture results..." -ForegroundColor Cyan
    node scripts/evaluate-user-guide-capture.js --mode report --viewports desktop
    $reportStatus = $LASTEXITCODE

    if ($exitCode -eq 0 -and $captureStatus -ne 0) {
        Write-Host "Playwright exited with status $captureStatus. See the output above." -ForegroundColor Red
        $exitCode = $captureStatus
    }
    if ($exitCode -eq 0 -and $reportStatus -ne 0) {
        Write-Host "Some desktop screenshots failed. The guide was generated with 'unavailable' cards for them." -ForegroundColor Red
        $exitCode = $reportStatus
    }
    Pop-Location
} finally {
}

$guideFile = Join-Path $RepoRoot "docs\user-guide\user-guide.md"
if (Test-Path $guideFile) {
    Write-Host ""
    Write-Host "Desktop user guide updated:" -ForegroundColor Green
    Write-Host "  $guideFile" -ForegroundColor White
}

exit $exitCode
