<#
.SYNOPSIS
    Install 1Helm on Windows 11 x64.

.DESCRIPTION
    1Helm on Windows runs the ordinary Linux build inside a WSL 2 distribution
    and serves its interface to the browser at http://localhost:8123. There is
    no Windows application to install, so there is nothing to code-sign and
    SmartScreen never appears.

    Usage, from an ordinary PowerShell window:

        irm https://1helm.com/install.ps1 | iex

    Windows cannot enable WSL 2 without restarting. When that is required this
    script says so plainly and exits; run the same command again afterwards and
    it continues from where it stopped. Every step is idempotent.

    Only two operations need administrator rights: enabling the Windows optional
    features, and installing Microsoft's WSL package. Those run in a separate
    elevated pass. Everything else - importing the distribution, installing
    1Helm inside it, registering the keepalive - deliberately runs as the
    signed-in user, because WSL state is per-user: a distribution imported by an
    elevated session started with different credentials would belong to that
    administrator instead of the person using the machine.

.PARAMETER InstallerUrl
    Override the Linux installer fetched inside the distribution. For testing a
    candidate build before it is published.

.PARAMETER LocalArchive
    Install from a local Linux release archive instead of resolving the current
    published release. Requires -LocalInstaller.

.PARAMETER LocalInstaller
    Path to a local Linux installer script, used with -LocalArchive.

.PARAMETER LocalArchiveSha256
    Optional SHA-256 the local archive must match, checked inside the
    distribution before anything is installed. Catches a truncated or stale copy.

.EXAMPLE
    irm https://1helm.com/install.ps1 | iex

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1 -LocalArchive C:\stage\1Helm-linux-node.tgz -LocalInstaller C:\stage\install.sh
#>
[CmdletBinding()]
param(
    [string] $Distro         = '1helm',
    [string] $InstallRoot    = 'C:\1helm',
    [int]    $HealthPort     = 8123,
    [string] $InstallerUrl   = 'https://1helm.com/install.sh',
    [string] $LocalArchive   = '',
    [string] $LocalInstaller = '',
    [string] $LocalArchiveSha256 = '',
    [string] $KeepaliveSource = '',
    [switch] $HostSetup,
    [string] $StatusPath     = ''
)

$ErrorActionPreference = 'Stop'
$env:WSL_UTF8 = '1'

# Microsoft's WSL package and Canonical's root filesystem are pinned by digest.
# The WSL installer must additionally carry a valid Microsoft Authenticode
# signature: a digest alone only proves we fetched what we expected, not that
# Microsoft produced it.
$WslVersion      = '2.7.10.0'
$WslInstallerUrl = 'https://github.com/microsoft/WSL/releases/download/2.7.10/wsl.2.7.10.0.x64.msi'
$WslInstallerSha = '1a62f90a43c03cc5bda47dfd0b6faf496ac70fd4389190518120a4f84fc895cf'
$RootfsUrl       = 'https://cloud-images.ubuntu.com/wsl/releases/24.04/20240423/ubuntu-noble-wsl-amd64-wsl.rootfs.tar.gz'
$RootfsSha       = '8251e27ffff381a4af5f41dcb94d867de3e0d9774a9241908ab34555d99315ea'

$WslExe   = Join-Path $env:SystemRoot 'System32\wsl.exe'
$Features = @('Microsoft-Windows-Subsystem-Linux', 'VirtualMachinePlatform')

function Say  { param([string]$m, [string]$c = 'Gray') Write-Host $m -ForegroundColor $c }
function Step { param([string]$m) Write-Host "==> $m" -ForegroundColor Cyan }
function Die  { param([string]$m) Write-Host "" ; Write-Host "1Helm setup stopped: $m" -ForegroundColor Red ; exit 1 }

function Test-Elevated {
    $id = [Security.Principal.WindowsIdentity]::GetCurrent()
    return ([Security.Principal.WindowsPrincipal]$id).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

# wsl.exe does not strip quotes from its own option values: `wsl -d "name"`
# looks for a distribution whose name literally contains the quotes. Quote only
# when whitespace genuinely requires it.
function ConvertTo-WslArg { param([string]$v) if ($v -match '\s') { return '"' + $v + '"' } return $v }

function Get-FileWithDigest {
    param([string]$Url, [string]$Destination, [string]$ExpectedSha)
    if ((Test-Path $Destination) -and ((Get-FileHash $Destination -Algorithm SHA256).Hash.ToLowerInvariant() -eq $ExpectedSha)) {
        Say "    already downloaded and verified: $(Split-Path -Leaf $Destination)"
        return
    }
    Say "    downloading $(Split-Path -Leaf $Destination) ..."
    $previous = $ProgressPreference
    $ProgressPreference = 'SilentlyContinue'   # orders of magnitude faster for large files
    try { Invoke-WebRequest -Uri $Url -OutFile $Destination -UseBasicParsing }
    finally { $ProgressPreference = $previous }
    $actual = (Get-FileHash $Destination -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actual -ne $ExpectedSha) {
        Remove-Item $Destination -Force -ErrorAction SilentlyContinue
        Die "$(Split-Path -Leaf $Destination) did not match its expected SHA-256. Expected $ExpectedSha, got $actual. Nothing was installed."
    }
    Say "    verified SHA-256"
}

function Test-FeatureEnabled {
    param([string]$Name)
    $f = Get-WindowsOptionalFeature -Online -FeatureName $Name -ErrorAction SilentlyContinue
    return ($null -ne $f -and [string]$f.State -eq 'Enabled')
}

# Windows cannot activate these features without a restart: they sit in
# EnablePending, DISM reports RestartRequired as the ambiguous "Possible", and
# the vmcompute service does not exist until the machine reboots. Any of those
# means "restart", not "broken".
function Test-RestartPending {
    if ($null -eq (Get-Service -Name vmcompute -ErrorAction SilentlyContinue)) { return $true }
    foreach ($name in $Features) {
        $f = Get-WindowsOptionalFeature -Online -FeatureName $name -ErrorAction SilentlyContinue
        if ($null -eq $f) { continue }
        if ([string]$f.State -ne 'Enabled') { return $true }
        $r = [string]$f.RestartRequired
        if ($r -eq 'Required' -or $r -eq '1' -or $r -eq 'True') { return $true }
    }
    return (Test-Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Component Based Servicing\RebootPending')
}

function Test-PinnedWsl {
    try {
        $out = (& $WslExe --version 2>&1 | Out-String) -replace "`0", ''
        return ($LASTEXITCODE -eq 0 -and $out -match [regex]::Escape($WslVersion))
    } catch { return $false }
}

function Get-Distros {
    try {
        $raw = (& $WslExe --list --quiet 2>$null | Out-String) -replace "`0", ''
        return @($raw -split "`r?`n" | ForEach-Object { $_.Trim() } | Where-Object { $_ })
    } catch { return @() }
}

function Invoke-InDistro {
    param([string[]]$ShellArgs, [switch]$AsRoot)
    $a = @('-d', (ConvertTo-WslArg $Distro))
    if ($AsRoot) { $a += @('-u', 'root') }
    $a += @('--exec') + $ShellArgs
    # The in-distro command's own output must go straight to the console, NOT
    # into this function's output stream. A PowerShell function returns
    # everything it emits, so without Out-Host `$code = Invoke-InDistro ...`
    # collects every line the command printed *and* the exit code into one
    # array. `$code -ne 0` is then an array filter, which is truthy for any
    # non-empty output, so a completely successful install is reported as a
    # failure with the whole transcript interpolated into the error message.
    & $WslExe @a | Out-Host
    return $LASTEXITCODE
}

# ---------------------------------------------------------------------------
# Elevated pass: optional features and Microsoft's WSL package only.
# ---------------------------------------------------------------------------
if ($HostSetup) {
    try {
        if (-not (Test-Elevated)) { exit 3 }
        $enabledNow = $false
        foreach ($name in $Features) {
            if (-not (Test-FeatureEnabled $name)) {
                Write-Host "    enabling $name ..."
                $null = Enable-WindowsOptionalFeature -Online -FeatureName $name -All -NoRestart
                $enabledNow = $true
            }
        }
        if (-not (Test-PinnedWsl)) {
            $tmp = Join-Path $env:TEMP ("1helm-wsl-" + [Guid]::NewGuid().ToString('N') + '.msi')
            try {
                $previous = $ProgressPreference; $ProgressPreference = 'SilentlyContinue'
                try { Invoke-WebRequest -Uri $WslInstallerUrl -OutFile $tmp -UseBasicParsing } finally { $ProgressPreference = $previous }
                $actual = (Get-FileHash $tmp -Algorithm SHA256).Hash.ToLowerInvariant()
                if ($actual -ne $WslInstallerSha) { Write-Host "WSL installer digest mismatch: $actual"; exit 4 }
                $sig = Get-AuthenticodeSignature -LiteralPath $tmp
                if ($sig.Status -ne 'Valid' -or $null -eq $sig.SignerCertificate -or
                    $sig.SignerCertificate.Subject -notmatch '(^|,\s*)CN=Microsoft Corporation(,|$)') {
                    Write-Host "WSL installer is not validly signed by Microsoft Corporation"; exit 5
                }
                Write-Host "    installing Microsoft WSL $WslVersion ..."
                $p = Start-Process -FilePath (Join-Path $env:SystemRoot 'System32\msiexec.exe') `
                        -ArgumentList @('/i', "`"$tmp`"", '/qn', '/norestart') -Wait -PassThru
                # 0 ok; 1641/3010 ok + reboot; 1638 a same/newer package is present.
                if ($p.ExitCode -in @(1641, 3010)) { $enabledNow = $true }
                elseif ($p.ExitCode -notin @(0, 1638) -and -not (Test-PinnedWsl)) {
                    Write-Host "msiexec failed with exit code $($p.ExitCode)"; exit 6
                }
            } finally { Remove-Item $tmp -Force -ErrorAction SilentlyContinue }
        }
        if ($enabledNow -or (Test-RestartPending)) { exit 10 }
        exit 0
    } catch {
        Write-Host "elevated host setup failed: $($_.Exception.Message)"
        exit 7
    }
}

# ---------------------------------------------------------------------------
# Main pass: runs as the signed-in user.
# ---------------------------------------------------------------------------
Write-Host ""
Say "1Helm for Windows" 'White'
Say "Runs the Linux build inside WSL 2. Your browser is the interface." 'DarkGray'
Write-Host ""

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
if ($identity.User.Value -eq 'S-1-5-18' -or $identity.Name -match '^NT AUTHORITY') {
    Die "this installer must run as your own Windows account, not as $($identity.Name). 1Helm's WSL state is per-user."
}
if ([Environment]::Is64BitOperatingSystem -ne $true -or $env:PROCESSOR_ARCHITECTURE -notin @('AMD64', 'x86')) {
    Die "1Helm requires 64-bit x64 Windows. Arm64 Windows is not supported by this build."
}
if ([Environment]::OSVersion.Version.Build -lt 22000) {
    Die "1Helm requires Windows 11 (build 22000 or newer). This is build $([Environment]::OSVersion.Version.Build)."
}
if ($LocalArchive -and -not $LocalInstaller) { Die "-LocalArchive requires -LocalInstaller." }

$null = New-Item -ItemType Directory -Path $InstallRoot -Force

# --- 1. Windows features and Microsoft's WSL package (elevated) -------------
Step "Checking Windows prerequisites"
$featuresReady = ($Features | ForEach-Object { Test-FeatureEnabled $_ }) -notcontains $false
if ($featuresReady -and (Test-PinnedWsl) -and -not (Test-RestartPending)) {
    Say "    WSL 2 is already enabled and Microsoft WSL $WslVersion is installed"
} else {
    $self = $PSCommandPath
    if (-not $self) {
        # Running from `irm | iex`, so there is no file on disk to re-invoke.
        # Persist a copy so the elevated pass and any post-restart resume can
        # both run the exact same script.
        $self = Join-Path $InstallRoot 'install.ps1'
        $MyInvocation.MyCommand.ScriptBlock.ToString() | Set-Content -LiteralPath $self -Encoding UTF8
        Say "    saved a copy of this installer to $self"
    }
    Say "    Windows needs administrator approval once, to enable WSL 2." 'Yellow'
    # Deliberately not named $args: that is a PowerShell automatic variable.
    $childArgs = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$self`"", '-HostSetup',
                   '-Distro', (ConvertTo-WslArg $Distro), '-InstallRoot', "`"$InstallRoot`"")
    $child = Start-Process -FilePath 'powershell.exe' -ArgumentList ($childArgs -join ' ') -Verb RunAs -Wait -PassThru
    # -Wait is not dependable for an elevated ShellExecute launch, so block on
    # the real handle before trusting the exit code.
    if ($null -ne $child) { try { $child.WaitForExit() } catch { } }
    $code = if ($null -eq $child) { $null } else { $child.ExitCode }

    if ($null -eq $code) { Die "administrator approval was cancelled, or Windows did not start the elevated step." }
    if ($code -eq 10 -or (Test-RestartPending)) {
        Write-Host ""
        Say "Restart required" 'Yellow'
        Say "Windows has enabled WSL 2 but cannot finish until it restarts. Nothing is lost." 'Yellow'
        Write-Host ""
        Say "  1. Restart this PC."
        Say "  2. Sign back in as the same Windows user."
        Say "  3. Run the same install command again - it continues from here."
        Write-Host ""
        exit 10
    }
    if ($code -ne 0) {
        switch ($code) {
            3 { Die "the elevated step did not receive administrator rights." }
            4 { Die "Microsoft's WSL installer did not match its expected digest. Nothing was installed." }
            5 { Die "Microsoft's WSL installer was not validly signed by Microsoft. Nothing was installed." }
            6 { Die "Microsoft's WSL installer failed. Try `wsl --install` manually, then run this again." }
            default { Die "the elevated step failed (exit $code)." }
        }
    }
    if (-not (Test-PinnedWsl)) { Die "Microsoft WSL $WslVersion is not usable in your session yet. Restart this PC and run the install command again." }
    Say "    WSL 2 is ready"
}

# --- 2. Port pre-flight -----------------------------------------------------
# Every WSL distribution shares ONE network namespace with Windows, so anything
# already listening on this port - another distribution, or a Windows process -
# will stop 1Helm binding it, and would answer the health probe in its place.
Step "Checking port $HealthPort is available"
$listener = $null
try {
    $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $HealthPort)
    $listener.Start()
    Say "    port $HealthPort is free"
} catch {
    $owner = ''
    try {
        $owner = (Get-NetTCPConnection -LocalPort $HealthPort -State Listen -ErrorAction SilentlyContinue |
                  Select-Object -First 1 | ForEach-Object { (Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue).ProcessName })
    } catch { }
    if ((Get-Distros) -contains $Distro) {
        Say "    port $HealthPort is in use - assuming it is this 1Helm installation" 'Yellow'
    } else {
        Die "port $HealthPort is already in use$(if ($owner) { " by '$owner'" }). Windows and every WSL distribution share one network namespace, so 1Helm cannot bind it. Stop whatever is using port $HealthPort and run this again."
    }
} finally {
    if ($null -ne $listener) { try { $listener.Stop() } catch { } }
}

# --- 3. The Linux distribution ---------------------------------------------
Step "Preparing the Linux runtime"
if ((Get-Distros) -contains $Distro) {
    Say "    distribution '$Distro' already exists"
} else {
    $rootfs = Join-Path $InstallRoot 'ubuntu-noble-wsl-amd64.rootfs.tar.gz'
    Get-FileWithDigest -Url $RootfsUrl -Destination $rootfs -ExpectedSha $RootfsSha
    $distroDir = Join-Path $InstallRoot 'distro'
    $null = New-Item -ItemType Directory -Path $distroDir -Force
    Say "    importing '$Distro' (this takes about a minute) ..."
    & $WslExe --import (ConvertTo-WslArg $Distro) (ConvertTo-WslArg $distroDir) (ConvertTo-WslArg $rootfs)
    if ($LASTEXITCODE -ne 0) { Die "could not import the Linux distribution (wsl --import exited $LASTEXITCODE)." }
    Remove-Item $rootfs -Force -ErrorAction SilentlyContinue
}

# systemd must be on before 1Helm's service can be managed. Writing wsl.conf
# needs a restart of the distribution to take effect.
$wslConfProbe = Invoke-InDistro -AsRoot -ShellArgs @('/bin/sh', '-c', 'grep -q "systemd=true" /etc/wsl.conf 2>/dev/null')
if ($wslConfProbe -ne 0) {
    Say "    enabling systemd ..."
    $null = Invoke-InDistro -AsRoot -ShellArgs @('/bin/sh', '-c', 'printf "[boot]\nsystemd=true\n" > /etc/wsl.conf')
    & $WslExe --terminate (ConvertTo-WslArg $Distro) | Out-Null
    Start-Sleep -Seconds 3
}
$initProbe = (& $WslExe -d (ConvertTo-WslArg $Distro) -u root --exec /bin/sh -c 'ps -p 1 -o comm=' 2>&1 | Out-String).Trim()
if ($initProbe -notmatch 'systemd') { Die "systemd is not running inside '$Distro' (PID 1 is '$initProbe'). Try `wsl --terminate $Distro` and run this again." }
Say "    systemd is running"

# --- 4. 1Helm itself, installed by the Linux installer ---------------------
Step "Installing 1Helm inside the Linux runtime"
Say "    this is the long step - it installs the container runtime and imports the channel image" 'DarkGray'
if ($LocalArchive) {
    if (-not (Test-Path $LocalArchive))   { Die "-LocalArchive not found: $LocalArchive" }
    if (-not (Test-Path $LocalInstaller)) { Die "-LocalInstaller not found: $LocalInstaller" }
    $stage = Join-Path $InstallRoot 'stage'
    $null = New-Item -ItemType Directory -Path $stage -Force
    Copy-Item $LocalArchive   (Join-Path $stage (Split-Path -Leaf $LocalArchive))   -Force
    Copy-Item $LocalInstaller (Join-Path $stage 'install-local.sh')                 -Force
    $stageInDistro = '/mnt/' + $stage.Substring(0,1).ToLowerInvariant() + ($stage.Substring(2) -replace '\\','/')
    if ($LocalArchiveSha256 -and $LocalArchiveSha256 -notmatch '^[a-fA-F0-9]{64}$') {
        Die "-LocalArchiveSha256 is not a SHA-256 digest: $LocalArchiveSha256"
    }
    $shaEnv = if ($LocalArchiveSha256) { "HELM_RELEASE_SHA256=$($LocalArchiveSha256.ToLowerInvariant()) " } else { '' }
    $code = Invoke-InDistro -AsRoot -ShellArgs @('/bin/sh', '-c',
        "set -e; cp -f '$stageInDistro/install-local.sh' /tmp/i.sh; tr -d '\r' < /tmp/i.sh > /tmp/install.sh; ${shaEnv}bash /tmp/install.sh '$stageInDistro/$(Split-Path -Leaf $LocalArchive)'")
} else {
    $code = Invoke-InDistro -AsRoot -ShellArgs @('/bin/bash', '-c',
        "set -o pipefail; curl -fsSL '$InstallerUrl' | bash")
}
if ($code -ne 0) { Die "the Linux installer failed (exit $code). The output above shows why; nothing further was changed." }

# --- 5. Keepalive ----------------------------------------------------------
# WSL tears down an idle distribution seconds after its last session closes,
# which would stop the server. A per-user scheduled task holds it open.
Step "Registering the 1Helm keepalive"
$keepaliveDir = Join-Path $InstallRoot 'keepalive'
$null = New-Item -ItemType Directory -Path $keepaliveDir -Force
$keepaliveFiles = @('keepalive-install.ps1', 'keepalive-run.ps1', 'keepalive-remove.ps1', 'keepalive-hold.sh')

# Fetched from the same origin as this installer, so the pair can never be
# mismatched. This is NOT optional: without the keepalive, WSL tears the
# distribution down when it goes idle and 1Helm silently stops answering.
if ($KeepaliveSource) {
    foreach ($f in $keepaliveFiles) {
        $src = Join-Path $KeepaliveSource $f
        if (-not (Test-Path $src)) { Die "keepalive file missing from -KeepaliveSource: $src" }
        Copy-Item $src (Join-Path $keepaliveDir $f) -Force
    }
    Say "    using keepalive scripts from $KeepaliveSource"
} else {
    $base = ($InstallerUrl -replace '/install\.sh$', '') + '/keepalive'
    foreach ($f in $keepaliveFiles) {
        $dest = Join-Path $keepaliveDir $f
        try {
            $previous = $ProgressPreference; $ProgressPreference = 'SilentlyContinue'
            try { Invoke-WebRequest -Uri "$base/$f" -OutFile $dest -UseBasicParsing } finally { $ProgressPreference = $previous }
        } catch { Die "could not download the keepalive component '$f' from $base ($($_.Exception.Message)). Without it 1Helm stops when its distribution goes idle." }
        if (-not (Test-Path $dest) -or (Get-Item $dest).Length -eq 0) { Die "the keepalive component '$f' downloaded empty from $base." }
    }
    Say "    downloaded keepalive components"
}

# bash refuses CRLF in a shebang script.
$hold = Join-Path $keepaliveDir 'keepalive-hold.sh'
[IO.File]::WriteAllText($hold, ([IO.File]::ReadAllText($hold) -replace "`r`n", "`n"), (New-Object Text.UTF8Encoding($false)))

& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $keepaliveDir 'keepalive-install.ps1') `
    -Distro $Distro -HealthPort $HealthPort -InstallDir $keepaliveDir
if ($LASTEXITCODE -ne 0) { Die "the keepalive could not be registered (exit $LASTEXITCODE). 1Helm would stop when its distribution goes idle." }

# --- 6. Shortcut and finish ----------------------------------------------
Step "Finishing up"
try {
    $programs = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'
    $null = New-Item -ItemType Directory -Path $programs -Force
    # A .lnk cannot address a URL. WScript.Shell accepts the assignment without
    # complaint and then saves a shortcut whose TargetPath is empty, so the Start
    # Menu entry appears and does nothing when clicked. An Internet Shortcut
    # (.url) is the supported way to put an address in the Start Menu, and it
    # opens in whichever browser the user has chosen as default.
    $url = Join-Path $programs '1Helm.url'
    Set-Content -LiteralPath $url -Encoding ASCII -Value @(
        '[InternetShortcut]'
        "URL=http://localhost:$HealthPort"
    )
    # Clear the broken .lnk an earlier version of this installer left behind.
    Remove-Item (Join-Path $programs '1Helm.lnk') -Force -ErrorAction SilentlyContinue
    Say "    added a Start Menu shortcut"
} catch { Say "    could not create the Start Menu shortcut: $($_.Exception.Message)" 'Yellow' }

$ready = $false
for ($i = 0; $i -lt 60; $i++) {
    try {
        $r = Invoke-WebRequest -Uri "http://localhost:$HealthPort/api/setup/status" -UseBasicParsing -TimeoutSec 5
        if ($r.StatusCode -eq 200) { $ready = $true; break }
    } catch { }
    Start-Sleep -Seconds 2
}

Write-Host ""
if ($ready) {
    Say "1Helm is running at http://localhost:$HealthPort" 'Green'
    try { Start-Process "http://localhost:$HealthPort" } catch { }
} else {
    Say "1Helm is installed, but http://localhost:$HealthPort did not answer yet." 'Yellow'
    Say "Give it a moment and open that address. If it stays unavailable, check:" 'Yellow'
    Say "  wsl -d $Distro -u root --exec systemctl status 1helm"
}
Write-Host ""
