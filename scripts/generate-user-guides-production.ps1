# generate-user-guides-production.ps1
# Captures desktop and mobile user-guide screenshots from the live production site and regenerates
# docs/user-guide/user-guide.md and docs/user-guide/user-guide.mobile.md.
#
# No local servers required - screenshots are taken from https://www.quizymode.com
#
# Usage: .\scripts\generate-user-guides-production.ps1
#
# Failed shots do not stop the run: the guides are still generated. The script then lists the failed shots
# and exits non-zero, so the failures are not silently ignored (AC 7.1.6).

. "$PSScriptRoot\_e2e-common.ps1"

$exitCode = 1

try {
    Test-Prerequisites

    $screenshotDirs = foreach ($theme in @("dark", "light")) {
        foreach ($viewport in @("desktop", "mobile")) {
            Join-Path $RepoRoot "docs\user-guide\screenshots\$theme\$viewport"
        }
    }

    foreach ($dir in $screenshotDirs) {
        if (Test-Path $dir) {
            Write-Host "Clearing previous screenshots in $dir..." -ForegroundColor Cyan
            Remove-Item -LiteralPath (Join-Path $dir "*.png") -Force -ErrorAction SilentlyContinue
        }
    }
    $reportFile = Join-Path $RepoRoot "docs\user-guide\screenshots\failures.json"
    if (Test-Path $reportFile) {
        Remove-Item -LiteralPath $reportFile -Force
    }

    Write-Host "Capturing desktop and mobile screenshots from production..." -ForegroundColor Cyan
    Push-Location $RepoRoot
    $env:PLAYWRIGHT_BASE_URL = "https://www.quizymode.com"
    npx playwright test --project=screenshots --project=screenshots-mobile
    $captureStatus = $LASTEXITCODE

    Write-Host "Generating desktop and mobile user guides..." -ForegroundColor Cyan
    node scripts/generate-user-guide.js --all
    $exitCode = $LASTEXITCODE

    Write-Host "Checking capture results..." -ForegroundColor Cyan
    node scripts/evaluate-user-guide-capture.js --mode report --viewports desktop,mobile
    $reportStatus = $LASTEXITCODE

    if ($exitCode -eq 0 -and $captureStatus -ne 0) {
        Write-Host "Playwright exited with status $captureStatus. See the output above." -ForegroundColor Red
        $exitCode = $captureStatus
    }
    if ($exitCode -eq 0 -and $reportStatus -ne 0) {
        Write-Host "Some screenshots failed. The guides were generated with 'unavailable' cards for them." -ForegroundColor Red
        $exitCode = $reportStatus
    }
    Pop-Location
} finally {
}

foreach ($guideFile in @(
    (Join-Path $RepoRoot "docs\user-guide\user-guide.md"),
    (Join-Path $RepoRoot "docs\user-guide\user-guide.mobile.md")
)) {
    if (Test-Path $guideFile) {
        Write-Host ""
        Write-Host "User guide updated:" -ForegroundColor Green
        Write-Host "  $guideFile" -ForegroundColor White
    }
}

exit $exitCode
