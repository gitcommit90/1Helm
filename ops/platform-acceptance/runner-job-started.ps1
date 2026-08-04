[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

function Refuse([string] $Message) {
    throw "Phase 4 runner refused: $Message"
}

if ($env:GITHUB_REPOSITORY -ne 'gitcommit90/1Helm') { Refuse 'another repository' }
if ($env:GITHUB_WORKFLOW -ne 'Candidate dress rehearsal') { Refuse 'another workflow' }
if ($env:GITHUB_WORKFLOW_REF -ne 'gitcommit90/1Helm/.github/workflows/candidate.yml@refs/heads/main') {
    Refuse 'another workflow path or ref'
}
if ($env:GITHUB_EVENT_NAME -ne 'workflow_run') { Refuse 'PR, fork, dispatch, and direct-push events' }
if ($env:GITHUB_JOB -ne 'accept-windows') { Refuse 'a non-allowlisted job' }
if ($env:GITHUB_REF -ne 'refs/heads/main' -or $env:GITHUB_SHA -notmatch '^[a-f0-9]{40}$') {
    Refuse 'a non-main or invalid workflow identity'
}
if (-not (Test-Path -LiteralPath $env:GITHUB_EVENT_PATH -PathType Leaf)) { Refuse 'a missing event payload' }

$event = Get-Content -LiteralPath $env:GITHUB_EVENT_PATH -Raw | ConvertFrom-Json
$run = $event.workflow_run
if ($event.repository.full_name -ne $env:GITHUB_REPOSITORY -or
    $run.head_repository.full_name -ne $env:GITHUB_REPOSITORY -or
    $run.name -ne 'CI' -or $run.event -ne 'push' -or $run.head_branch -ne 'main' -or
    $run.head_sha -ne $env:GITHUB_SHA -or $run.status -ne 'completed' -or $run.conclusion -ne 'success') {
    Refuse 'an untrusted repository/ref/SHA/CI event'
}
