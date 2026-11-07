# generate-user-guides-local.ps1
# Captures desktop and mobile user-guide screenshots from the local dev stack and regenerates
# docs/user-guide/user-guide.md and docs/user-guide/user-guide.mobile.md.
#
# Prerequisites: start Aspire first in a separate terminal:
#   cd src/Quizymode.Api.AppHost && dotnet run
#
# Usage:
#   .\scripts\generate-user-guides-local.ps1
#   .\scripts\generate-user-guides-local.ps1 -Password "your-password"
#
# Failed shots do not stop the run: the guides are still generated. The script then lists the failed shots
# and exits non-zero, so the failures are not silently ignored (AC 7.1.6).

param(
    [string]$Password
)

if ($Password) { $env:TEST_USER_PASSWORD = $Password }

. "$PSScriptRoot\_e2e-common.ps1"

$react = $null
$exitCode = 1

try {
    Test-Prerequisites
    Assert-ApiIsUp
    $react = Start-ReactDevServer
    Wait-ForReact
    Invoke-AuthSetup

    $env:PLAYWRIGHT_BASE_URL = "http://localhost:7000"
    Push-Location $RepoRoot

    $desktopScreenshotDir = Join-Path $RepoRoot "docs\user-guide\screenshots\user"
    $mobileScreenshotDir = Join-Path $RepoRoot "docs\user-guide\screenshots\mobile"

    foreach ($dir in @($desktopScreenshotDir, $mobileScreenshotDir)) {
        if (Test-Path $dir) {
            Write-Host "Clearing previous screenshots in $dir..." -ForegroundColor Cyan
            Remove-Item -LiteralPath (Join-Path $dir "*.png") -Force -ErrorAction SilentlyContinue
        }
    }
    $reportFile = Join-Path $RepoRoot "docs\user-guide\screenshots\failures.json"
    if (Test-Path $reportFile) {
        Remove-Item -LiteralPath $reportFile -Force
    }

    Write-Host "Capturing desktop and mobile screenshots from local dev stack..." -ForegroundColor Cyan
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
    Stop-ReactDevServer $react
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
