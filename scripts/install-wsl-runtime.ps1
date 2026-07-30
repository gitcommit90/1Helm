param(
  [Parameter(Mandatory = $true)][string]$RuntimeName,
  [Parameter(Mandatory = $true)][string]$AppRoot,
  [switch]$HostSetup
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

function Test-PinnedWslRuntime {
  $output = (& $wsl --version 2>&1 | Out-String)
  return $LASTEXITCODE -eq 0 -and $output -match [regex]::Escape($wslVersion)
}

if ($HostSetup) {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = [Security.Principal.WindowsPrincipal]::new($identity)
  if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "The WSL host setup phase requires administrator approval."
  }
  $wslFeature = Get-WindowsOptionalFeature -Online -FeatureName Microsoft-Windows-Subsystem-Linux
  $vmFeature = Get-WindowsOptionalFeature -Online -FeatureName VirtualMachinePlatform
  if ($wslFeature.State -ne "Enabled") { Enable-WindowsOptionalFeature -Online -FeatureName Microsoft-Windows-Subsystem-Linux -All -NoRestart | Out-Null }
  if ($vmFeature.State -ne "Enabled") { Enable-WindowsOptionalFeature -Online -FeatureName VirtualMachinePlatform -All -NoRestart | Out-Null }
  $restartRequired = (Get-WindowsOptionalFeature -Online -FeatureName Microsoft-Windows-Subsystem-Linux).RestartRequired -or
    (Get-WindowsOptionalFeature -Online -FeatureName VirtualMachinePlatform).RestartRequired
  $hostTemporary = Join-Path ([System.IO.Path]::GetTempPath()) ("1helm-wsl-host-" + [Guid]::NewGuid().ToString("N"))
  New-Item -ItemType Directory -Path $hostTemporary | Out-Null
  try {
  if (-not (Test-PinnedWslRuntime)) {
    $msi = Join-Path $hostTemporary "wsl.candidate.msi"
    Invoke-WebRequest -UseBasicParsing -Uri $wslInstallerUrl -OutFile $msi
    if ((Get-FileHash -LiteralPath $msi -Algorithm SHA256).Hash.ToLowerInvariant() -ne $wslInstallerSha256) {
      throw "Microsoft WSL installer did not match 1Helm's pinned SHA-256."
    }
    $signature = Get-AuthenticodeSignature -LiteralPath $msi
    if ($signature.Status -ne [System.Management.Automation.SignatureStatus]::Valid -or $null -eq $signature.SignerCertificate -or
        $signature.SignerCertificate.Subject -notmatch '(^|,\s*)CN=Microsoft Corporation(,|$)') {
      throw "Microsoft WSL installer did not have a valid Microsoft Corporation signature."
    }
    $installer = Start-Process -FilePath "$env:SystemRoot\System32\msiexec.exe" -ArgumentList @("/i", $msi, "/qn", "/norestart") -Wait -PassThru
    if ($installer.ExitCode -notin @(0, 1641, 3010)) { throw "Microsoft WSL installer failed with exit code $($installer.ExitCode)." }
    if ($installer.ExitCode -in @(1641, 3010)) { $restartRequired = $true }
  }
  if ($restartRequired) {
    exit 10
  }
  if (-not (Test-PinnedWslRuntime)) { throw "Microsoft WSL $wslVersion was installed but could not be verified." }
  & $wsl --set-default-version 2
  if ($LASTEXITCODE -ne 0) { throw "WSL could not set version 2 as the default." }
  } finally {
    if (Test-Path -LiteralPath $hostTemporary) { Remove-Item -LiteralPath $hostTemporary -Recurse -Force }
  }
  exit 0
}

# Keep the distribution owned by the signed-in Windows account. Only optional
# features and Microsoft's signed WSL package cross the UAC boundary; importing
# the distribution in that child would attach it to a different administrator
# when over-the-shoulder credentials are used.
$hostArguments = @(
  "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", ('"{0}"' -f $PSCommandPath),
  "-RuntimeName", $RuntimeName, "-AppRoot", ('"{0}"' -f $AppRoot), "-HostSetup"
) -join " "
$hostProcess = Start-Process -FilePath "powershell.exe" -ArgumentList $hostArguments -Verb RunAs -Wait -PassThru
if ($hostProcess.ExitCode -eq 10) {
  Write-Host "WSL 2 features are enabled. Restart Windows once, then retry 1Helm computer setup."
  exit 10
}
if ($hostProcess.ExitCode -ne 0) { throw "The administrator-approved WSL host setup failed with exit code $($hostProcess.ExitCode)." }
if (-not (Test-PinnedWslRuntime)) { throw "Microsoft WSL $wslVersion is not ready in the signed-in user's session." }

$AppRoot = [System.IO.Path]::GetFullPath($AppRoot)
$required = @(
  (Join-Path $AppRoot "scripts\1helm-oci-runtime"),
  (Join-Path $AppRoot "deploy\1helm-oci-runtime-v1.conf"),
  (Join-Path $AppRoot "container\Containerfile.oci")
)
foreach ($source in $required) {
  if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { throw "The packaged OCI runtime contract is incomplete." }
}

$temporary = Join-Path ([System.IO.Path]::GetTempPath()) ("1helm-oci-runtime-" + [Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $temporary | Out-Null
try {

  $names = @(& $wsl --list --quiet | ForEach-Object { $_.Trim() } | Where-Object { $_ })
  $runtimeRoot = Join-Path $env:LOCALAPPDATA "1Helm-Runtime"
  $installDirectory = Join-Path $runtimeRoot $RuntimeName
  if ($names -notcontains $RuntimeName) {
    if (Test-Path -LiteralPath $installDirectory) { throw "The shared runtime disk directory already exists without a registered runtime." }
    New-Item -ItemType Directory -Path $installDirectory -Force | Out-Null
    $rootfs = Join-Path $temporary "ubuntu-noble-wsl.rootfs.tar.gz"
    Invoke-WebRequest -UseBasicParsing -Uri $rootfsUrl -OutFile $rootfs
    if ((Get-FileHash -LiteralPath $rootfs -Algorithm SHA256).Hash.ToLowerInvariant() -ne $rootfsSha256) {
      throw "Ubuntu's pinned WSL rootfs failed SHA-256 verification."
    }
    & $wsl --import $RuntimeName $installDirectory $rootfs --version 2
    if ($LASTEXITCODE -ne 0) { throw "The shared 1Helm WSL runtime could not be imported." }
  }

  $bootstrap = @'
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y --no-install-recommends acl ca-certificates crun fuse-overlayfs podman python3 sudo uidmap util-linux
apt-get clean
rm -rf /var/lib/apt/lists/*
id 1helm >/dev/null 2>&1 || useradd --system --home-dir /var/lib/1helm-oci-v1 --no-create-home --shell /usr/sbin/nologin 1helm
install -d -m 0755 /etc/1helm /usr/libexec /usr/lib/1helm-oci
printf '[automount]\nenabled=false\nmountFsTab=false\n\n[interop]\nenabled=false\nappendWindowsPath=false\n\n[user]\ndefault=root\n\n[boot]\nsystemd=true\n' >/etc/wsl.conf
'@
  & $wsl --distribution $RuntimeName --user root --exec /bin/bash -lc $bootstrap
  if ($LASTEXITCODE -ne 0) { throw "The shared 1Helm runtime prerequisites could not be installed." }

  $unc = "\\wsl.localhost\$RuntimeName"
  Copy-Item -LiteralPath $required[0] -Destination "$unc\usr\libexec\1helm-oci-runtime" -Force
  Copy-Item -LiteralPath $required[1] -Destination "$unc\etc\1helm\oci-runtime-v1.conf" -Force
  Copy-Item -LiteralPath $required[2] -Destination "$unc\usr\lib\1helm-oci\Containerfile.oci" -Force
  & $wsl --distribution $RuntimeName --user root --exec /bin/chmod 0755 /usr/libexec/1helm-oci-runtime
  if ($LASTEXITCODE -ne 0) { throw "The OCI runtime helper permissions could not be applied." }
  & $wsl --terminate $RuntimeName
  if ($LASTEXITCODE -ne 0) { throw "The shared runtime could not restart into its isolation policy." }
  & $wsl --distribution $RuntimeName --user root --exec /usr/libexec/1helm-oci-runtime ready
  if ($LASTEXITCODE -ne 0) { throw "The shared OCI runtime did not pass readiness verification." }
  Write-Host "1Helm's shared OCI runtime is installed and ready."
} finally {
  if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Recurse -Force }
}
