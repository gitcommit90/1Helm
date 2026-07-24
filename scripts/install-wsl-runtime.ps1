#Requires -RunAsAdministrator
$ErrorActionPreference = "Stop"

# One host-level approval enables Microsoft's WSL 2 platform. Per-channel
# Ubuntu distributions are imported later by 1Helm as the signed-in Windows
# user; this script creates no shared distro and removes no existing distro.

$wslVersion = "2.7.10.0"
$wslInstallerUrl = "https://github.com/microsoft/WSL/releases/download/2.7.10/wsl.2.7.10.0.x64.msi"
$wslInstallerSha256 = "1a62f90a43c03cc5bda47dfd0b6faf496ac70fd4389190518120a4f84fc895cf"

if ([System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture -ne [System.Runtime.InteropServices.Architecture]::X64) {
  throw "This 1Helm build requires Microsoft's x64 WSL runtime."
}

$wslFeature = Get-WindowsOptionalFeature -Online -FeatureName Microsoft-Windows-Subsystem-Linux
$vmFeature = Get-WindowsOptionalFeature -Online -FeatureName VirtualMachinePlatform
if ($wslFeature.State -ne "Enabled") {
  Enable-WindowsOptionalFeature -Online -FeatureName Microsoft-Windows-Subsystem-Linux -All -NoRestart | Out-Null
}
if ($vmFeature.State -ne "Enabled") {
  Enable-WindowsOptionalFeature -Online -FeatureName VirtualMachinePlatform -All -NoRestart | Out-Null
}

$restartRequired = (Get-WindowsOptionalFeature -Online -FeatureName Microsoft-Windows-Subsystem-Linux).RestartRequired -or
  (Get-WindowsOptionalFeature -Online -FeatureName VirtualMachinePlatform).RestartRequired

function Test-PinnedWslRuntime {
  $versionOutput = (& "$env:SystemRoot\System32\wsl.exe" --version 2>&1 | Out-String)
  return $LASTEXITCODE -eq 0 -and $versionOutput -match [regex]::Escape($wslVersion)
}

if (-not (Test-PinnedWslRuntime)) {
  $candidateDirectory = Join-Path ([System.IO.Path]::GetTempPath()) ("1helm-wsl-" + [Guid]::NewGuid().ToString("N"))
  $candidate = Join-Path $candidateDirectory "wsl.candidate.msi"
  try {
    New-Item -ItemType Directory -Path $candidateDirectory | Out-Null
    Invoke-WebRequest -UseBasicParsing -Uri $wslInstallerUrl -OutFile $candidate

    $digest = (Get-FileHash -LiteralPath $candidate -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($digest -ne $wslInstallerSha256) {
      throw "Microsoft WSL installer did not match 1Helm's pinned SHA-256."
    }

    $signature = Get-AuthenticodeSignature -LiteralPath $candidate
    if ($signature.Status -ne [System.Management.Automation.SignatureStatus]::Valid -or
        $null -eq $signature.SignerCertificate -or
        $signature.SignerCertificate.Subject -notmatch '(^|,\s*)CN=Microsoft Corporation(,|$)') {
      throw "Microsoft WSL installer did not have a valid Microsoft Corporation Authenticode signature."
    }

    $installer = Start-Process -FilePath "$env:SystemRoot\System32\msiexec.exe" -ArgumentList @(
      "/i", $candidate, "/qn", "/norestart"
    ) -Wait -PassThru
    if ($installer.ExitCode -notin @(0, 1641, 3010)) {
      throw "Microsoft WSL installer failed with exit code $($installer.ExitCode)."
    }
    if ($installer.ExitCode -in @(1641, 3010)) { $restartRequired = $true }
  } finally {
    if (Test-Path -LiteralPath $candidate) { Remove-Item -LiteralPath $candidate -Force }
    if (Test-Path -LiteralPath $candidateDirectory) { Remove-Item -LiteralPath $candidateDirectory -Force }
  }
}

if (-not $restartRequired) {
  if (-not (Test-PinnedWslRuntime)) {
    throw "Microsoft WSL $wslVersion was installed but could not be verified."
  }
  & "$env:SystemRoot\System32\wsl.exe" --set-default-version 2
  if ($LASTEXITCODE -ne 0) { throw "WSL could not set version 2 as the default." }
}

if ($restartRequired) {
  Write-Host "WSL 2 features are enabled. Restart Windows once, then reopen 1Helm."
  exit 10
}
Write-Host "WSL 2 is installed and ready for 1Helm's private channel distributions."
