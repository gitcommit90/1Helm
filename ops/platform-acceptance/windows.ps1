[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$Root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$Archive = (Resolve-Path $env:HELM_CANDIDATE_ARCHIVE).Path
$OfflineArchive = (Resolve-Path $env:HELM_CANDIDATE_OFFLINE_ARCHIVE).Path
$ManifestPath = (Resolve-Path $env:HELM_CANDIDATE_MANIFEST).Path
$ProvenancePath = (Resolve-Path $env:HELM_CANDIDATE_PROVENANCE).Path
$Output = $env:HELM_ACCEPTANCE_OUTPUT
$StartedAt = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
$Manifest = Get-Content -Raw $ManifestPath | ConvertFrom-Json
$Commit = [string]$Manifest.source.commit
$Version = [string]$Manifest.version
$Digest = [string]$Manifest.artifact.sha256
$OfflineDigest = [string]$Manifest.offline_bundle.sha256
$CiRun = [string]$Manifest.ci.run_id
$Wsl = Join-Path $env:SystemRoot 'System32\wsl.exe'
$Distro = '1helm-phase4'
$Unrelated = '1helm-phase4-unrelated'
$InstallRoot = 'C:\1helm-phase4'
$InstallScript = Join-Path $Root 'site\public\install.ps1'
$UninstallScript = Join-Path $Root 'site\public\uninstall.ps1'
$KeepaliveSource = Join-Path $Root 'site\public\keepalive'

function Refuse([string] $Message) { throw "Windows acceptance refused: $Message" }
function Get-Distros {
    $raw = (& $Wsl --list --quiet 2>$null | Out-String) -replace "`0", ''
    return @($raw -split "`r?`n" | ForEach-Object { $_.Trim() } | Where-Object { $_ })
}
function Invoke-Distro([string] $Command) {
    # PowerShell 5 either re-quotes native arguments or adds a BOM when piping
    # text to wsl.exe. Write exact UTF-8 without a BOM to the runner temp mount,
    # then execute it from a login shell so the installed node path is present.
    $tempRoot = if ($env:RUNNER_TEMP) { $env:RUNNER_TEMP } else { $env:TEMP }
    $script = Join-Path $tempRoot ("1helm-distro-{0}.sh" -f [guid]::NewGuid().ToString('N'))
    $encoding = New-Object System.Text.UTF8Encoding($false)
    [IO.File]::WriteAllText($script, $Command + "`n", $encoding)
    $drive = $script.Substring(0, 1).ToLowerInvariant()
    $scriptInDistro = "/mnt/$drive/" + ($script.Substring(3) -replace '\\', '/')
    try {
        & $Wsl -d $Distro -u root --exec /bin/bash -lc "bash '$scriptInDistro'" | Out-Host
        if ($LASTEXITCODE -ne 0) { Refuse "in-distribution command failed: $Command" }
    } finally {
        Remove-Item $script -Force -ErrorAction SilentlyContinue
    }
}
function Assert-DistroVersion([string] $ExpectedVersion) {
    if ($ExpectedVersion -notmatch '^\d+\.\d+\.\d+$') { Refuse 'expected distribution version is invalid' }
    # A single-quoted here-string is literal PowerShell text. The previous calls
    # used backslash-escaped double quotes (shell syntax, not PowerShell syntax),
    # which ended the PowerShell string and executed `systemctl` on Windows.
    # Substitute only the already-validated semver after constructing the exact
    # bash command, so every service/version assertion really runs inside WSL.
    # 1Helm bundles its own Node at the installed /opt/1helm/node-current
    # contract path; there is no global `node` on the distro PATH, so invoke
    # the bundled binary by absolute path.
    $command = @'
test "$(systemctl is-active 1helm.service)" = active
test "$(/opt/1helm/node-current/bin/node -p 'require("/opt/1helm/current/package.json").version')" = '__EXPECTED__'
'@
    Invoke-Distro ($command.Replace('__EXPECTED__', $ExpectedVersion))
}

if ($env:GITHUB_REPOSITORY -ne 'gitcommit90/1Helm' -or $env:GITHUB_EVENT_NAME -ne 'workflow_run' -or
    $env:GITHUB_REF -ne 'refs/heads/main' -or $env:GITHUB_SHA -ne $Commit -or
    $env:HELM_EXPECTED_COMMIT -ne $Commit -or $env:HELM_EXPECTED_CI_RUN_ID -ne $CiRun -or
    $Manifest.source.state -ne 'trusted-main' -or $Manifest.ci.workflow -ne 'CI' -or $Manifest.ci.conclusion -ne 'success') {
    Refuse 'repository, event, ref, commit, or successful CI identity changed'
}
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
if ($identity.User.Value -eq 'S-1-5-18' -or $identity.Name -match '^NT AUTHORITY') { Refuse 'runner is not the dedicated signed-in user account' }
if (([Security.Principal.WindowsPrincipal]$identity).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { Refuse 'runner account must not be elevated' }
if (Test-Path $InstallRoot) { Refuse "dedicated install root is not clean: $InstallRoot" }
foreach ($name in @($Distro, $Unrelated)) { if ((Get-Distros) -contains $name) { Refuse "dedicated distribution already exists: $name" } }
$env:HELM_ACCEPTANCE_PLATFORM = 'windows'
$env:HELM_ACCEPTANCE_STARTED_AT = $StartedAt
node (Join-Path $Root 'scripts\pending-acceptance-evidence.mjs')
if ($LASTEXITCODE -ne 0) { Refuse 'could not retain pending Windows evidence' }

# This runner is provisioned after its one-time WSL feature/reboot proof. The
# provisioning record is root-owned outside the work directory and is consumed
# read-only here; automation never invents UAC/reboot success.
$Provisioning = 'C:\ProgramData\1Helm-Phase4\provisioning-evidence.json'
if (-not (Test-Path $Provisioning)) { Refuse 'one-time clean-feature, single-UAC, restart/resume provisioning evidence is missing' }
$Provision = Get-Content -Raw $Provisioning | ConvertFrom-Json
if ($Provision.schema -ne 1 -or $Provision.kind -ne '1helm-windows-runner-provisioning' -or
    $Provision.features_initially_disabled -ne $true -or $Provision.single_uac -ne $true -or
    $Provision.restart_required -ne $true -or $Provision.same_user_resume -ne $true -or
    $Provision.keepalive_after_sign_in -ne $true -or $Provision.service_active -ne $true -or
    $Provision.localhost_health -ne $true -or $Provision.snapshot_baseline -ne $true -or
    $Provision.dedicated -ne $true -or $Provision.production_data -ne $false) {
    Refuse 'one-time real-restart and accepted-snapshot provisioning proof is incomplete'
}
if ((Get-FileHash $Archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $Digest) { Refuse 'Linux TGZ digest changed' }
if ((Get-FileHash $OfflineArchive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $OfflineDigest) { Refuse 'Linux offline TGZ digest changed' }
gh attestation verify $Archive --bundle $ProvenancePath `
    --repo gitcommit90/1Helm --signer-workflow gitcommit90/1Helm/.github/workflows/candidate.yml `
    --source-ref refs/heads/main --source-digest $Commit --deny-self-hosted-runners
if ($LASTEXITCODE -ne 0) { Refuse 'hosted Linux candidate attestation verification failed' }
gh attestation verify $OfflineArchive --bundle $ProvenancePath `
    --repo gitcommit90/1Helm --signer-workflow gitcommit90/1Helm/.github/workflows/candidate.yml `
    --source-ref refs/heads/main --source-digest $Commit --deny-self-hosted-runners
if ($LASTEXITCODE -ne 0) { Refuse 'hosted Linux offline candidate attestation verification failed' }

$Rootfs = 'C:\ProgramData\1Helm-Phase4\ubuntu-noble-wsl-amd64.rootfs.tar.gz'
if (-not (Test-Path $Rootfs)) { Refuse 'pinned offline WSL rootfs is missing from the dedicated runner' }
$RootfsSha = '8251e27ffff381a4af5f41dcb94d867de3e0d9774a9241908ab34555d99315ea'
if ((Get-FileHash $Rootfs -Algorithm SHA256).Hash.ToLowerInvariant() -ne $RootfsSha) { Refuse 'pinned runner rootfs digest mismatch' }
$unrelatedRoot = Join-Path $env:TEMP '1helm-phase4-unrelated'
$previousArchive = $null
try {
    New-Item -ItemType Directory -Path $unrelatedRoot -Force | Out-Null
    & $Wsl --import $Unrelated $unrelatedRoot $Rootfs
    if ($LASTEXITCODE -ne 0) { Refuse 'could not create unrelated WSL safety control' }

# Clean install the exact candidate first through the tracked site-equivalent
# Windows entry point, prove onboarding and health, then remove only that target
# so the same VM can exercise the distinct prior-to-candidate path.
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $InstallScript `
    -Distro $Distro -InstallRoot $InstallRoot -LocalArchive $OfflineArchive `
    -LocalInstaller (Join-Path $Root 'site\public\install.sh') -LocalArchiveSha256 $OfflineDigest `
    -LocalRootfs $Rootfs -LocalRootfsSha256 $RootfsSha `
    -KeepaliveSource $KeepaliveSource
if ($LASTEXITCODE -ne 0) { Refuse "exact candidate clean install failed with exit $LASTEXITCODE" }
if (-not ((Get-Distros) -ccontains $Distro) -or -not ((Get-Distros) -ccontains $Unrelated)) { Refuse 'clean install did not retain both target and unrelated control distributions' }
$cleanHealth = Invoke-WebRequest -Uri 'http://localhost:8123/api/setup/status' -UseBasicParsing -TimeoutSec 10
if ($cleanHealth.StatusCode -ne 200 -or -not (($cleanHealth.Content | ConvertFrom-Json).needs_setup)) { Refuse 'candidate clean install did not expose localhost onboarding health' }
Assert-DistroVersion $Version
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $UninstallScript -Distro $Distro -InstallRoot $InstallRoot -Force
if ($LASTEXITCODE -ne 0 -or (Get-Distros) -ccontains $Distro -or -not ((Get-Distros) -ccontains $Unrelated) -or (Test-Path $InstallRoot)) {
    Refuse 'clean-install teardown was not scoped to the exact target'
}

# Resolve the newest public Stable Linux archive distinct from the candidate.
# Install that through the tracked site path, seed state, then use the exact
# retained candidate's atomic Linux updater transaction.
$headers = @{ Accept = 'application/vnd.github+json'; Authorization = "Bearer $env:GH_TOKEN"; 'X-GitHub-Api-Version' = '2022-11-28' }
$releases = Invoke-RestMethod -Uri "https://api.github.com/repos/$env:GITHUB_REPOSITORY/releases?per_page=20" -Headers $headers
$previous = @($releases | Where-Object { -not $_.draft -and -not $_.prerelease -and $_.tag_name -match '^v\d+\.\d+\.\d+$' -and $_.tag_name.Substring(1) -ne $Version })[0]
if ($null -eq $previous) { Refuse 'no distinct prior Stable release exists for updater acceptance' }
$PreviousVersion = [string]$previous.tag_name.Substring(1)
$PreviousName = "1Helm-$PreviousVersion-linux-node.tgz"
$PreviousAsset = @($previous.assets | Where-Object name -eq $PreviousName)[0]
if ($null -eq $PreviousAsset -or [string]$PreviousAsset.digest -notmatch '^sha256:[a-f0-9]{64}$') { Refuse 'prior Stable Linux asset lacks digest-qualified metadata' }
$PreviousArchive = Join-Path $env:TEMP $PreviousName
$previousArchive = $PreviousArchive
$PreviousDigest = ([string]$PreviousAsset.digest).Substring(7)
# PowerShell 5's generic web client has repeatedly spent nearly an hour
# streaming this ~400 MB release asset only to leave bytes that fail the
# published digest. The authenticated GitHub CLI is already required above for
# provenance verification and writes the release asset directly as binary.
gh release download "v$PreviousVersion" --repo $env:GITHUB_REPOSITORY `
    --pattern $PreviousName --dir $env:TEMP --clobber
if ($LASTEXITCODE -ne 0 -or -not (Test-Path $PreviousArchive)) { Refuse 'prior Stable Linux download failed' }
if ((Get-FileHash $PreviousArchive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $PreviousDigest) { Refuse 'prior Stable Linux digest mismatch' }

# Site-equivalent prior Stable install. This is the tracked site installer with
# only its documented local archive inputs, running as the signed-in user.
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $InstallScript `
    -Distro $Distro -InstallRoot $InstallRoot -LocalArchive $PreviousArchive `
    -LocalInstaller (Join-Path $Root 'site\public\install.sh') -LocalArchiveSha256 $PreviousDigest `
    -LocalRootfs $Rootfs -LocalRootfsSha256 $RootfsSha `
    -KeepaliveSource $KeepaliveSource
if ($LASTEXITCODE -ne 0) { Refuse "site-equivalent install failed with exit $LASTEXITCODE" }
if (-not ((Get-Distros) -ccontains $Distro)) { Refuse 'target WSL distribution was not imported' }
if (-not ((Get-Distros) -ccontains $Unrelated)) { Refuse 'unrelated WSL control disappeared during install' }

$health = Invoke-WebRequest -Uri 'http://localhost:8123/api/setup/status' -UseBasicParsing -TimeoutSec 10
if ($health.StatusCode -ne 200 -or -not (($health.Content | ConvertFrom-Json).needs_setup)) { Refuse 'prior Stable localhost health did not report a clean install' }
Assert-DistroVersion $PreviousVersion

# Stage the exact candidate as a verified retained release, then apply its real
# atomic Linux update transaction from prior Stable to candidate.
Invoke-Distro "install -o 1helm -g 1helm -m 0600 /dev/stdin /var/lib/1helm-oci-v1/phase4-acceptance-state <<< phase4-$env:GITHUB_RUN_ID-$env:GITHUB_RUN_ATTEMPT"
$StateBefore = (& $Wsl -d $Distro -u root --exec sha256sum /var/lib/1helm-oci-v1/phase4-acceptance-state | Out-String).Split()[0]
$Stage = Join-Path $InstallRoot 'candidate-stage'
New-Item -ItemType Directory -Path $Stage -Force | Out-Null
Copy-Item $Archive (Join-Path $Stage 'candidate.tgz') -Force
$StageInDistro = '/mnt/' + $Stage.Substring(0,1).ToLowerInvariant() + ($Stage.Substring(2) -replace '\\','/')
$CandidateRelease = "/opt/1helm/releases/$Version-$Digest"
Invoke-Distro "set -e; rm -rf '$CandidateRelease.tmp'; mkdir -p '$CandidateRelease.tmp'; tar -xzf '$StageInDistro/candidate.tgz' -C '$CandidateRelease.tmp' --strip-components=1; chown -R 1helm:1helm '$CandidateRelease.tmp'; mv '$CandidateRelease.tmp' '$CandidateRelease'; '$CandidateRelease/site/public/apply-linux-release.sh' '$CandidateRelease' '$Version'"
Assert-DistroVersion $Version
$StateAfterUpdate = (& $Wsl -d $Distro -u root --exec sha256sum /var/lib/1helm-oci-v1/phase4-acceptance-state | Out-String).Split()[0]
if ($StateBefore -ne $StateAfterUpdate) { Refuse 'WSL data marker changed across update' }

# A self-hosted job cannot honestly survive an in-job Windows reboot. The
# dedicated VM is restored to the administrator-accepted clean snapshot before
# routing, and this exact run exercises the reboot-sensitive product boundary:
# stop the limited-user logon keepalive, cold-stop only the target WSL VM, then
# start that same task and require service, localhost, and state recovery. The
# normalized record calls this a snapshot-assisted equivalent, never a reboot.
$KeepaliveTaskPath = '\1Helm\'
$KeepaliveTaskName = '1Helm-WSL-Keepalive'
$KeepaliveTask = Get-ScheduledTask -TaskPath $KeepaliveTaskPath -TaskName $KeepaliveTaskName -ErrorAction SilentlyContinue
if ($null -eq $KeepaliveTask) { Refuse 'limited same-user logon keepalive task is missing' }
$CurrentUser = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$HasLogonTrigger = @($KeepaliveTask.Triggers | Where-Object { $_.CimClass.CimClassName -eq 'MSFT_TaskLogonTrigger' }).Count -ge 1
if ($KeepaliveTask.Principal.UserId -ne $CurrentUser -or
    [string]$KeepaliveTask.Principal.RunLevel -ne 'Limited' -or -not $HasLogonTrigger) {
    Refuse 'limited same-user logon keepalive task is missing or changed'
}
Stop-ScheduledTask -TaskPath $KeepaliveTaskPath -TaskName $KeepaliveTaskName -ErrorAction Stop
& $Wsl --terminate $Distro | Out-Null
if ($LASTEXITCODE -ne 0) { Refuse 'targeted WSL cold stop failed' }
Start-ScheduledTask -TaskPath $KeepaliveTaskPath -TaskName $KeepaliveTaskName -ErrorAction Stop
$Recovered = $false
for ($i = 0; $i -lt 90; $i++) {
    try {
        $resumeHealth = Invoke-WebRequest -Uri 'http://localhost:8123/api/setup/status' -UseBasicParsing -TimeoutSec 5
        if ($resumeHealth.StatusCode -eq 200) { $Recovered = $true; break }
    } catch { }
    Start-Sleep -Seconds 2
}
if (-not $Recovered) { Refuse 'snapshot-assisted WSL cold-start equivalent did not recover localhost health' }
Assert-DistroVersion $Version
$StateAfter = (& $Wsl -d $Distro -u root --exec sha256sum /var/lib/1helm-oci-v1/phase4-acceptance-state | Out-String).Split()[0]
if ($StateBefore -ne $StateAfter) { Refuse 'WSL data marker changed across update or cold-start equivalent' }

& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $UninstallScript -Distro $Distro -InstallRoot $InstallRoot -Force
if ($LASTEXITCODE -ne 0) { Refuse 'scoped uninstall returned failure' }
$distrosAfter = Get-Distros
if ($distrosAfter -ccontains $Distro) { Refuse 'target distribution survived uninstall' }
if (-not ($distrosAfter -ccontains $Unrelated)) { Refuse 'uninstall touched the unrelated WSL control' }
if (Test-Path $InstallRoot) { Refuse 'target install root survived uninstall' }

$env:HELM_STATE_BEFORE_SHA256 = $StateBefore
$env:HELM_STATE_AFTER_SHA256 = $StateAfter
$env:HELM_PREVIOUS_VERSION = $PreviousVersion
$env:HELM_MACHINE_OS_VERSION = [Environment]::OSVersion.Version.ToString()
$env:HELM_PROVISIONING_EVIDENCE = $Provisioning
node (Join-Path $Root 'scripts\windows-acceptance-evidence.mjs')
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} finally {
    # Best-effort teardown touches only the exact Phase 4 names. Any failure
    # remains blocked evidence and leaves the VM snapshot disposable.
    if ((Get-Distros) -ccontains $Distro) {
        & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $UninstallScript -Distro $Distro -InstallRoot $InstallRoot -Force | Out-Host
    }
    if ((Get-Distros) -ccontains $Unrelated) { & $Wsl --unregister $Unrelated | Out-Null }
    Remove-Item $unrelatedRoot -Recurse -Force -ErrorAction SilentlyContinue
    if ($previousArchive) { Remove-Item $previousArchive -Force -ErrorAction SilentlyContinue }
}
