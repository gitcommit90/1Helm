[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$Root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$Archive = (Resolve-Path $env:HELM_RELEASE_ARCHIVE).Path
$Version = [string]$env:HELM_RELEASE_VERSION
$Digest = [string]$env:HELM_RELEASE_SHA256
$Wsl = Join-Path $env:SystemRoot 'System32\wsl.exe'
$Distro = '1helm-release-test'
$InstallRoot = 'C:\1helm-release-test'
$InstallScript = Join-Path $Root 'site\public\install.ps1'
$UninstallScript = Join-Path $Root 'site\public\uninstall.ps1'
$KeepaliveSource = Join-Path $Root 'site\public\keepalive'
$Rootfs = 'C:\ProgramData\1Helm-Phase4\ubuntu-noble-wsl-amd64.rootfs.tar.gz'
$RootfsSha = '8251e27ffff381a4af5f41dcb94d867de3e0d9774a9241908ab34555d99315ea'

function Refuse([string] $Message) { throw "Windows fresh install failed: $Message" }
function Get-Distros {
    $raw = (& $Wsl --list --quiet 2>$null | Out-String) -replace "`0", ''
    return @($raw -split "`r?`n" | ForEach-Object { $_.Trim() } | Where-Object { $_ })
}

if ($env:RUNNER_NAME -ne '1helm-windows-phase4') { Refuse 'not running as the dedicated Windows test user' }
if ($Version -notmatch '^\d+\.\d+\.\d+$' -or $Digest -notmatch '^[a-f0-9]{64}$') { Refuse 'invalid version or digest' }
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
if ($identity.User.Value -eq 'S-1-5-18' -or $identity.Name -match '^NT AUTHORITY') { Refuse 'runner is SYSTEM' }
if (([Security.Principal.WindowsPrincipal]$identity).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { Refuse 'runner is elevated' }
if ((Get-FileHash $Archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $Digest) { Refuse 'archive digest changed' }
if (-not (Test-Path $Rootfs) -or (Get-FileHash $Rootfs -Algorithm SHA256).Hash.ToLowerInvariant() -ne $RootfsSha) { Refuse 'clean WSL rootfs is missing or changed' }
# These exact names exist only for the release check. Clear residue left by a
# cancelled job before proving another fresh installation.
if ((Get-Distros) -ccontains $Distro) { & $Wsl --unregister $Distro | Out-Null }
Remove-Item $InstallRoot -Recurse -Force -ErrorAction SilentlyContinue
if ((Get-Distros) -contains $Distro -or (Test-Path $InstallRoot)) { Refuse 'the dedicated install target could not be cleaned' }

try {
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $InstallScript `
        -Distro $Distro -InstallRoot $InstallRoot -LocalArchive $Archive `
        -LocalInstaller (Join-Path $Root 'site\public\install.sh') -LocalArchiveSha256 $Digest `
        -LocalRootfs $Rootfs -LocalRootfsSha256 $RootfsSha -KeepaliveSource $KeepaliveSource
    if ($LASTEXITCODE -ne 0) { Refuse "installer exited $LASTEXITCODE" }
    if (-not ((Get-Distros) -ccontains $Distro)) { Refuse 'WSL distribution was not installed' }
    $health = Invoke-WebRequest -Uri 'http://localhost:8123/api/setup/status' -UseBasicParsing -TimeoutSec 15
    if ($health.StatusCode -ne 200 -or -not (($health.Content | ConvertFrom-Json).needs_setup)) { Refuse 'localhost onboarding is not healthy' }
    $installedPackage = (& $Wsl -d $Distro -u root --exec /bin/cat /opt/1helm/current/package.json | Out-String)
    if ($LASTEXITCODE -ne 0) { Refuse 'installed package metadata could not be read' }
    $installed = [string](($installedPackage | ConvertFrom-Json).version)
    if ($installed -ne $Version) { Refuse "installed version is '$installed'" }
    Write-Host "Windows fresh install passed for 1Helm $Version."
} finally {
    if ((Get-Distros) -ccontains $Distro) {
        & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $UninstallScript -Distro $Distro -InstallRoot $InstallRoot -Force | Out-Host
    }
    if ((Get-Distros) -ccontains $Distro) { & $Wsl --unregister $Distro | Out-Null }
    Remove-Item $InstallRoot -Recurse -Force -ErrorAction SilentlyContinue
}
