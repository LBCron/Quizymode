# generate-user-guide-local.ps1
# Captures desktop user-guide screenshots from the local dev stack and regenerates
# docs/user-guide/user-guide.md.
#
# Prerequisites: start Aspire first in a separate terminal:
#   cd src/Quizymode.Api.AppHost && dotnet run
#
# Usage:
#   .\scripts\generate-user-guide-local.ps1
#   .\scripts\generate-user-guide-local.ps1 -Password "your-password"
#
# Failed shots do not stop the run: the guide is still generated. The script then lists the failed shots
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

    $screenshotDir = Join-Path $RepoRoot "docs\user-guide\screenshots\user"
    if (Test-Path $screenshotDir) {
        Write-Host "Clearing previous desktop screenshots..." -ForegroundColor Cyan
        Remove-Item -LiteralPath (Join-Path $screenshotDir "*.png") -Force -ErrorAction SilentlyContinue
    }
    $reportFile = Join-Path $RepoRoot "docs\user-guide\screenshots\failures.json"
    if (Test-Path $reportFile) {
        Remove-Item -LiteralPath $reportFile -Force
    }

    Write-Host "Capturing desktop screenshots from local dev stack..." -ForegroundColor Cyan
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
    Stop-ReactDevServer $react
}

$guideFile = Join-Path $RepoRoot "docs\user-guide\user-guide.md"
if (Test-Path $guideFile) {
    Write-Host ""
    Write-Host "Desktop user guide updated:" -ForegroundColor Green
    Write-Host "  $guideFile" -ForegroundColor White
}

exit $exitCode
