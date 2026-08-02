param(
  [Parameter(Mandatory = $true)][string]$RuntimeName,
  [Parameter(Mandatory = $true)][string]$AppRoot,
  [switch]$HostSetup,
  # Shared status file path so elevated HostSetup can report real errors to the parent/UI.
  [string]$StatusPath = ""
)

$ErrorActionPreference = "Stop"
$wsl = "$env:SystemRoot\System32\wsl.exe"
$wslVersion = "2.7.10.0"
$wslInstallerUrl = "https://github.com/microsoft/WSL/releases/download/2.7.10/wsl.2.7.10.0.x64.msi"
$wslInstallerSha256 = "1a62f90a43c03cc5bda47dfd0b6faf496ac70fd4389190518120a4f84fc895cf"
$rootfsUrl = "https://cloud-images.ubuntu.com/wsl/releases/24.04/20240423/ubuntu-noble-wsl-amd64-wsl.rootfs.tar.gz"
$rootfsSha256 = "8251e27ffff381a4af5f41dcb94d867de3e0d9774a9241908ab34555d99315ea"

if ($RuntimeName -notmatch '^1helm-[a-f0-9]{16}-runtime$') { throw "The shared runtime name is invalid." }
if ([System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture -ne [System.Runtime.InteropServices.Architecture]::X64) {
  throw "This 1Helm build requires Microsoft's x64 WSL runtime."
}

if ($StatusPath) { $env:HELM_WSL_SETUP_STATUS = $StatusPath }

# Script-scoped: both elevated host setup and the signed-in owner path download files.
function Fetch-File {
  param([string]$Url, [string]$Destination)
  $curl = "curl.exe"
  if (Get-Command $curl -ErrorAction SilentlyContinue) {
    & $curl -fsSLo $Destination $Url
    if ($LASTEXITCODE -ne 0) { throw "curl failed to download $Url" }
  } else {
    Invoke-WebRequest -UseBasicParsing -Uri $Url -OutFile $Destination
  }
}

# wsl.exe emits UTF-16LE. Captured as a .NET string that still contains NULs, so
# version/list matches fail unless the NULs are stripped first.
function Get-WslText {
  param([Parameter(Mandatory = $true)][string[]]$ArgumentList)
  # Windows PowerShell promotes native stderr to ErrorRecord objects. With the
  # script-wide Stop policy, an expected nonzero probe (such as --version on a
  # genuinely fresh host) otherwise aborts before we can inspect LASTEXITCODE
  # and install WSL. Keep the probe non-terminating, then restore fail-closed
  # behavior for the surrounding setup transaction.
  $previousErrorAction = $ErrorActionPreference
  try {
    $ErrorActionPreference = "Continue"
    $raw = & $wsl @ArgumentList 2>&1 | Out-String
    $code = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousErrorAction
  }
  $text = ($raw -replace [char]0, "").Trim()
  return [pscustomobject]@{ ExitCode = $code; Text = $text }
}

function Test-PinnedWslRuntime {
  $result = Get-WslText -ArgumentList @("--version")
  return $result.ExitCode -eq 0 -and $result.Text -match [regex]::Escape($wslVersion)
}

function Test-RestartRequired {
  param($Feature)
  if ($null -eq $Feature) { return $false }
  $value = [string]$Feature.RestartRequired
  return $value -eq "Required" -or $value -eq "1" -or $value -eq "True"
}

function Test-WslRestartFailure {
  param([string]$Text)
  return $Text -match 'HCS_E_SERVICE_NOT_AVAILABLE|required feature is not installed'
}

function Require-WindowsRestart {
  $message = "Restart this PC to finish enabling WSL 2, then open 1Helm again. Setup continues automatically."
  Write-SetupStatus -Status "restart_required" -Step $message -Progress 20 -ErrorMessage "Windows must restart to finish enabling WSL 2. No other action is needed."
  Write-Host $message
  exit 10
}

# Windows cannot activate the WSL 2 features until it reboots: the features sit
# in EnablePending, DISM reports RestartRequired as the ambiguous "Possible",
# and the vmcompute service does not exist yet. Any of those is a reboot, not a
# failure, and must never be reported to the Captain as a broken installation.
function Test-PendingWslRestart {
  if ($null -eq (Get-Service -Name vmcompute -ErrorAction SilentlyContinue)) { return $true }
  foreach ($name in @("Microsoft-Windows-Subsystem-Linux", "VirtualMachinePlatform")) {
    $feature = Get-WindowsOptionalFeature -Online -FeatureName $name -ErrorAction SilentlyContinue
    if ($null -eq $feature) { continue }
    if ([string]$feature.State -ne "Enabled") { return $true }
    if (Test-RestartRequired $feature) { return $true }
  }
  return (Test-Path -LiteralPath 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Component Based Servicing\RebootPending')
}

function Get-WslDistributionNames {
  $result = Get-WslText -ArgumentList @("--list", "--quiet")
  if ($result.ExitCode -ne 0) { return @() }
  return @(
    $result.Text -split "(\r?\n)+" |
      ForEach-Object { $_.Trim() } |
      Where-Object { $_ }
  )
}

function Write-SetupStatus {
  param(
    [string]$Status,
    [string]$Step,
    [int]$Progress,
    [string]$ErrorMessage = ""
  )
  Write-Host $Step
  $path = $env:HELM_WSL_SETUP_STATUS
  if (-not $path) { return }
  try {
    $dir = Split-Path -Parent $path
    if ($dir -and -not (Test-Path -LiteralPath $dir)) {
      New-Item -ItemType Directory -Path $dir -Force | Out-Null
    }
    $payload = @{
      status = $Status
      step = $Step
      progress = $Progress
      error = $ErrorMessage
      updated = (Get-Date).ToUniversalTime().ToString("o")
    } | ConvertTo-Json -Compress
    # Windows PowerShell's "utf8" encoding writes a BOM that turns status text into
    # mojibake (e.g. "base...") in the Electron UI. Write plain UTF-8 instead.
    [System.IO.File]::WriteAllText($path, $payload, [System.Text.UTF8Encoding]::new($false))
  } catch {
    # Status reporting must never abort setup.
  }
}

function Fail-Setup {
  param([string]$Message, [int]$Code = 1)
  Write-SetupStatus -Status "failed" -Step $Message -Progress 0 -ErrorMessage $Message
  Write-Host "ERROR: $Message" -ForegroundColor Red
  exit $Code
}

function Read-ReportedSetupStatus {
  $path = $env:HELM_WSL_SETUP_STATUS
  if (-not $path -or -not (Test-Path -LiteralPath $path -PathType Leaf)) { return $null }
  try {
    return Get-Content -LiteralPath $path -Raw | ConvertFrom-Json
  } catch {
    return $null
  }
}

# The elevated process exit code is not authoritative across every Windows
# PowerShell/UAC host. The shared status file is the transaction record: in
# particular, never continue into the signed-in-user WSL probe after the
# elevated pass has declared that a reboot is required.
function Get-HostSetupOutcome {
  param([Nullable[int]]$ExitCode)
  $reported = Read-ReportedSetupStatus
  if ($null -ne $reported -and $reported.status -eq "restart_required") {
    $step = if ($reported.step) { [string]$reported.step } else { "WSL 2 features are enabled. Restart Windows once, then retry 1Helm computer setup." }
    $errorMessage = if ($reported.error) { [string]$reported.error } else { "Windows restart required to finish enabling WSL 2." }
    return [pscustomobject]@{ Status = "restart_required"; Step = $step; Detail = $errorMessage }
  }
  if ($null -ne $reported -and $reported.status -eq "failed") {
    $detail = if ($reported.error) { [string]$reported.error } elseif ($reported.step) { [string]$reported.step } else { "The administrator-approved WSL host setup failed." }
    return [pscustomobject]@{ Status = "failed"; Step = $detail; Detail = $detail }
  }
  if ($null -eq $ExitCode) {
    $detail = "Administrator approval was cancelled or Windows did not start the elevated WSL host setup."
    return [pscustomobject]@{ Status = "failed"; Step = $detail; Detail = $detail }
  }
  if ($ExitCode -eq 10) {
    return [pscustomobject]@{
      Status = "restart_required"
      Step = "WSL 2 features are enabled. Restart Windows once, then retry 1Helm computer setup."
      Detail = "Windows restart required to finish enabling WSL 2."
    }
  }
  if ($ExitCode -ne 0) {
    $detail = "The administrator-approved WSL host setup failed with exit code $ExitCode."
    return [pscustomobject]@{ Status = "failed"; Step = $detail; Detail = $detail }
  }
  return [pscustomobject]@{ Status = "continue"; Step = ""; Detail = "" }
}

if ($HostSetup) {
  try {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [Security.Principal.WindowsPrincipal]::new($identity)
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
      Fail-Setup "The WSL host setup phase requires administrator approval."
    }
    Write-SetupStatus -Status "running" -Step "Enabling Windows WSL features..." -Progress 8
    $wslFeature = Get-WindowsOptionalFeature -Online -FeatureName Microsoft-Windows-Subsystem-Linux
    $vmFeature = Get-WindowsOptionalFeature -Online -FeatureName VirtualMachinePlatform
    $enabledWslFeatureNow = $wslFeature.State -ne "Enabled"
    $enabledVmFeatureNow = $vmFeature.State -ne "Enabled"
    if ($enabledWslFeatureNow) { Enable-WindowsOptionalFeature -Online -FeatureName Microsoft-Windows-Subsystem-Linux -All -NoRestart | Out-Null }
    if ($enabledVmFeatureNow) { Enable-WindowsOptionalFeature -Online -FeatureName VirtualMachinePlatform -All -NoRestart | Out-Null }
    $wslFeature = Get-WindowsOptionalFeature -Online -FeatureName Microsoft-Windows-Subsystem-Linux
    $vmFeature = Get-WindowsOptionalFeature -Online -FeatureName VirtualMachinePlatform
    # DISM's RestartRequired enum can stringify as "Possible" even though its
    # numeric value is 1. Enabling either feature in this invocation is itself
    # authoritative evidence that Windows must reboot before a WSL 2 VM import.
    $restartRequired = $enabledWslFeatureNow -or $enabledVmFeatureNow -or (Test-RestartRequired $wslFeature) -or (Test-RestartRequired $vmFeature)
    $hostTemporary = Join-Path ([System.IO.Path]::GetTempPath()) ("1helm-wsl-host-" + [Guid]::NewGuid().ToString("N"))
    New-Item -ItemType Directory -Path $hostTemporary | Out-Null
    try {
      if (-not (Test-PinnedWslRuntime)) {
        $msi = Join-Path $hostTemporary "wsl.candidate.msi"
        Write-SetupStatus -Status "running" -Step "Downloading Microsoft WSL installer..." -Progress 12
        Fetch-File -Url $wslInstallerUrl -Destination $msi
        if ((Get-FileHash -LiteralPath $msi -Algorithm SHA256).Hash.ToLowerInvariant() -ne $wslInstallerSha256) {
          Fail-Setup "Microsoft WSL installer did not match 1Helm's pinned SHA-256."
        }
        $signature = Get-AuthenticodeSignature -LiteralPath $msi
        if ($signature.Status -ne [System.Management.Automation.SignatureStatus]::Valid -or $null -eq $signature.SignerCertificate -or
            $signature.SignerCertificate.Subject -notmatch '(^|,\s*)CN=Microsoft Corporation(,|$)') {
          Fail-Setup "Microsoft WSL installer did not have a valid Microsoft Corporation signature."
        }
        Write-SetupStatus -Status "running" -Step "Installing Microsoft WSL $wslVersion..." -Progress 18
        $installer = Start-Process -FilePath "$env:SystemRoot\System32\msiexec.exe" -ArgumentList @("/i", $msi, "/qn", "/norestart") -Wait -PassThru
        # 0 success; 1641/3010 success+reboot; 1638 already installed (same/newer).
        # 1603 is a hard fail from msiexec, but on machines that already have the
        # pinned WSL build (or UTF-16 made detection fail earlier) the package may
        # still leave a working runtime - re-verify before failing closed.
        if ($installer.ExitCode -in @(1641, 3010)) { $restartRequired = $true }
        elseif ($installer.ExitCode -notin @(0, 1638)) {
          if (Test-PinnedWslRuntime) {
            Write-Host "Microsoft WSL installer returned $($installer.ExitCode), but pinned WSL $wslVersion is already present; continuing."
          } else {
            Fail-Setup "Microsoft WSL installer failed with exit code $($installer.ExitCode)."
          }
        }
      } else {
        Write-SetupStatus -Status "running" -Step "Microsoft WSL $wslVersion is already installed." -Progress 18
      }
      # A feature may already report Enabled before the reboot has registered
      # WSL's VM compute service. This is the concrete pre-reboot state that
      # otherwise lets setup continue into HCS_E_SERVICE_NOT_AVAILABLE.
      if ($null -eq (Get-Service -Name vmcompute -ErrorAction SilentlyContinue)) { $restartRequired = $true }
      if ($restartRequired) {
        Require-WindowsRestart
      }
      if (-not (Test-PinnedWslRuntime)) { Fail-Setup "Microsoft WSL $wslVersion was installed but could not be verified." }
      Write-SetupStatus -Status "running" -Step "Setting WSL 2 as the default..." -Progress 22
      $defaultVersion = Get-WslText -ArgumentList @("--set-default-version", "2")
      if ($defaultVersion.ExitCode -ne 0) {
        if (Test-WslRestartFailure $defaultVersion.Text) { Require-WindowsRestart }
        Fail-Setup "WSL could not set version 2 as the default. $($defaultVersion.Text)"
      }
    } finally {
      if (Test-Path -LiteralPath $hostTemporary) { Remove-Item -LiteralPath $hostTemporary -Recurse -Force }
    }
    exit 0
  } catch {
    $message = $_.Exception.Message
    if (-not $message) { $message = "$_" }
    Fail-Setup $message
  }
}

# Keep the distribution owned by the signed-in Windows account. Only optional
# features and Microsoft's signed WSL package cross the UAC boundary; importing
# the distribution in that child would attach it to a different administrator
# when over-the-shoulder credentials are used.
try {
  Write-SetupStatus -Status "running" -Step "Requesting administrator approval for WSL host setup..." -Progress 5
  $statusArg = if ($env:HELM_WSL_SETUP_STATUS) { $env:HELM_WSL_SETUP_STATUS } else { "" }
  $hostArguments = @(
    "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", ('"{0}"' -f $PSCommandPath),
    "-RuntimeName", $RuntimeName, "-AppRoot", ('"{0}"' -f $AppRoot), "-HostSetup"
  )
  if ($statusArg) {
    $hostArguments += @("-StatusPath", ('"{0}"' -f $statusArg))
  }
  $hostProcess = Start-Process -FilePath "powershell.exe" -ArgumentList ($hostArguments -join " ") -Verb RunAs -Wait -PassThru
  # -Wait is not dependable for an elevated ShellExecute launch: it can return
  # while the child is still enabling Windows features. Continuing here probes
  # for a WSL runtime the child has not finished installing and reports a false
  # failure, so block on the real process handle before reading any outcome.
  if ($null -ne $hostProcess) {
    try { $hostProcess.WaitForExit() } catch { }
  }
  $hostExitCode = if ($null -eq $hostProcess) { $null } else { $hostProcess.ExitCode }
  # The status file is written by the child immediately before it exits. Give a
  # bounded grace period for a terminal record rather than racing its last write.
  $settleDeadline = (Get-Date).AddSeconds(30)
  while ((Get-Date) -lt $settleDeadline) {
    $pending = Read-ReportedSetupStatus
    if ($null -ne $pending -and @("restart_required", "failed", "complete") -contains [string]$pending.status) { break }
    Start-Sleep -Milliseconds 500
  }
  $hostOutcome = Get-HostSetupOutcome -ExitCode $hostExitCode
  if ($hostOutcome.Status -eq "restart_required") {
    Write-SetupStatus -Status "restart_required" -Step $hostOutcome.Step -Progress 20 -ErrorMessage $hostOutcome.Detail
    Write-Host $hostOutcome.Step
    exit 10
  }
  if ($hostOutcome.Status -eq "failed") {
    # A reboot that Windows has not taken yet is the single most common reason
    # the elevated pass cannot finish. Tell the Captain to restart instead of
    # presenting a failed installation they cannot act on.
    if (Test-PendingWslRestart) { Require-WindowsRestart }
    Fail-Setup $hostOutcome.Detail
  }
  if (-not (Test-PinnedWslRuntime)) {
    if (Test-PendingWslRestart) { Require-WindowsRestart }
    Fail-Setup "Microsoft WSL $wslVersion is not ready in the signed-in user's session."
  }

  $AppRoot = [System.IO.Path]::GetFullPath($AppRoot)
  $required = @(
    (Join-Path $AppRoot "scripts\1helm-oci-runtime"),
    (Join-Path $AppRoot "deploy\1helm-oci-runtime-v1.conf"),
    (Join-Path $AppRoot "container\Containerfile.oci"),
    (Join-Path $AppRoot "container\channel-machine.oci.tar"),
    (Join-Path $AppRoot "container\channel-machine.oci.sha256")
  )
  foreach ($source in $required) {
    if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
      Fail-Setup "The packaged OCI runtime contract is incomplete: missing $(Split-Path -Leaf $source)."
    }
  }
  $expectedImageSha = (Get-Content -LiteralPath $required[4] -Raw).Trim().ToLowerInvariant()
  if ($expectedImageSha -notmatch '^[a-f0-9]{64}$') { Fail-Setup "The sealed channel image digest file is invalid." }
  $actualImageSha = (Get-FileHash -LiteralPath $required[3] -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actualImageSha -ne $expectedImageSha) { Fail-Setup "The sealed channel image digest does not match." }

  $temporary = Join-Path ([System.IO.Path]::GetTempPath()) ("1helm-oci-runtime-" + [Guid]::NewGuid().ToString("N"))
  New-Item -ItemType Directory -Path $temporary | Out-Null
  try {
    Write-SetupStatus -Status "running" -Step "Checking for the shared 1Helm WSL runtime..." -Progress 28
    $names = @(Get-WslDistributionNames)
    $runtimeRoot = Join-Path $env:LOCALAPPDATA "1Helm-Runtime"
    $installDirectory = Join-Path $runtimeRoot $RuntimeName
    $partialMarker = "$installDirectory.1helm-partial-import"
    if ($names -notcontains $RuntimeName) {
      if (Test-Path -LiteralPath $installDirectory) {
        $entries = @(Get-ChildItem -LiteralPath $installDirectory -Force -ErrorAction SilentlyContinue)
        $ownedPartial = (Test-Path -LiteralPath $partialMarker -PathType Leaf) -and ((Get-Content -LiteralPath $partialMarker -Raw).Trim() -eq $RuntimeName)
        # v0.0.33 could leave an empty app-owned directory when Windows rejected
        # the import before creating its VM. New attempts carry an ownership
        # marker so an interrupted partial VHD can also be retried safely.
        if ($entries.Count -eq 0 -or $ownedPartial) {
          Remove-Item -LiteralPath $installDirectory -Recurse -Force
        } else {
          Fail-Setup "The shared runtime disk directory already exists without a registered runtime. Remove `"$installDirectory`" or unregister the partial distro, then retry."
        }
      }
      New-Item -ItemType Directory -Path $installDirectory -Force | Out-Null
      [System.IO.File]::WriteAllText($partialMarker, $RuntimeName, [System.Text.UTF8Encoding]::new($false))
      $rootfs = Join-Path $temporary "ubuntu-noble-wsl.rootfs.tar.gz"
      Write-SetupStatus -Status "running" -Step "Downloading shared Linux runtime base..." -Progress 35
      Fetch-File -Url $rootfsUrl -Destination $rootfs
      if ((Get-FileHash -LiteralPath $rootfs -Algorithm SHA256).Hash.ToLowerInvariant() -ne $rootfsSha256) {
        Fail-Setup "Ubuntu's pinned WSL rootfs failed SHA-256 verification."
      }
      Write-SetupStatus -Status "running" -Step "Importing shared Linux runtime..." -Progress 48
      $imported = Get-WslText -ArgumentList @("--import", $RuntimeName, $installDirectory, $rootfs, "--version", "2")
      if ($imported.ExitCode -ne 0) {
        if (Test-WslRestartFailure $imported.Text) { Require-WindowsRestart }
        Fail-Setup "The shared 1Helm WSL runtime could not be imported. $($imported.Text)"
      }
      Remove-Item -LiteralPath $partialMarker -Force
    }

    Write-SetupStatus -Status "running" -Step "Installing shared runtime packages (podman, crun, ...)..." -Progress 58
    $bootstrap = @'
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y --no-install-recommends acl ca-certificates crun fuse-overlayfs iptables podman python3 sudo uidmap util-linux
apt-get clean
rm -rf /var/lib/apt/lists/*
id 1helm >/dev/null 2>&1 || useradd --system --home-dir /var/lib/1helm-oci-v1 --no-create-home --shell /usr/sbin/nologin 1helm
install -d -m 0755 /etc/1helm /usr/libexec /usr/lib/1helm-oci
printf '[automount]\nenabled=false\nmountFsTab=false\n\n[interop]\nenabled=false\nappendWindowsPath=false\n\n[user]\ndefault=root\n\n[boot]\nsystemd=true\n' >/etc/wsl.conf
'@
    $bootstrapped = Get-WslText -ArgumentList @("--distribution", $RuntimeName, "--user", "root", "--exec", "/bin/bash", "-lc", $bootstrap)
    if ($bootstrapped.ExitCode -ne 0) { Fail-Setup "The shared 1Helm runtime prerequisites could not be installed. $($bootstrapped.Text)" }

    Write-SetupStatus -Status "running" -Step "Installing the sealed OCI helper and channel image..." -Progress 78
    $unc = "\\wsl.localhost\$RuntimeName"
    Copy-Item -LiteralPath $required[0] -Destination "$unc\usr\libexec\1helm-oci-runtime" -Force
    Copy-Item -LiteralPath $required[1] -Destination "$unc\etc\1helm\oci-runtime-v1.conf" -Force
    Copy-Item -LiteralPath $required[2] -Destination "$unc\usr\lib\1helm-oci\Containerfile.oci" -Force
    Copy-Item -LiteralPath $required[3] -Destination "$unc\usr\lib\1helm-oci\channel-machine.oci.tar" -Force
    Copy-Item -LiteralPath $required[4] -Destination "$unc\usr\lib\1helm-oci\channel-machine.oci.sha256" -Force
    $meta = Join-Path $AppRoot "container\channel-machine.oci.json"
    if (Test-Path -LiteralPath $meta -PathType Leaf) {
      Copy-Item -LiteralPath $meta -Destination "$unc\usr\lib\1helm-oci\channel-machine.oci.json" -Force
    }
    $chmod = Get-WslText -ArgumentList @("--distribution", $RuntimeName, "--user", "root", "--exec", "/bin/chmod", "0755", "/usr/libexec/1helm-oci-runtime")
    if ($chmod.ExitCode -ne 0) { Fail-Setup "The OCI runtime helper permissions could not be applied. $($chmod.Text)" }
    Write-SetupStatus -Status "running" -Step "Restarting the shared runtime into its isolation policy..." -Progress 88
    $terminated = Get-WslText -ArgumentList @("--terminate", $RuntimeName)
    if ($terminated.ExitCode -ne 0) { Fail-Setup "The shared runtime could not restart into its isolation policy. $($terminated.Text)" }
    Write-SetupStatus -Status "running" -Step "Verifying the shared OCI runtime..." -Progress 94
    $ready = Get-WslText -ArgumentList @("--distribution", $RuntimeName, "--user", "root", "--exec", "/usr/libexec/1helm-oci-runtime", "ready")
    if ($ready.ExitCode -ne 0) { Fail-Setup "The shared OCI runtime did not pass readiness verification. $($ready.Text)" }
    Write-SetupStatus -Status "complete" -Step "1Helm's shared OCI runtime is installed and ready." -Progress 100
    Write-Host "1Helm's shared OCI runtime is installed and ready."
  } finally {
    if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Recurse -Force }
  }
} catch {
  $message = $_.Exception.Message
  if (-not $message) { $message = "$_" }
  Fail-Setup $message
}
