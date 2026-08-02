<#
.SYNOPSIS
    1Helm WSL keepalive supervisor - the process the Scheduled Task runs.

.DESCRIPTION
    Windows tears down an idle WSL 2 distro ~15 seconds after its last session
    closes. 1Helm on Windows runs the ordinary Linux build inside a WSL distro
    with the browser as the GUI, so something must hold that distro open for
    the whole logon session. This script is that something.

    Two supervision layers:

      Windows side (this script)
        - keeps exactly one "anchor" wsl.exe session alive, restarting it if it
          dies for any reason;
        - every DeepCheckEvery ticks, verifies the distro is listed as running
          AND http://localhost:<HealthPort>/ answers;
        - escalates to a guarded distro recycle if that keeps failing.

      Linux side (keepalive-hold.sh, launched as the anchor)
        - exists, which is what actually pins the distro up;
        - re-starts the systemd unit if it stops.

    Runs as the signed-in user. Never as Local System: WSL state is user-scoped,
    so a SYSTEM-context distro would be a different instance with different
    localhost forwarding.

.NOTES
    This script NEVER calls `wsl --shutdown` - that would kill every distro on
    the box including other users' runtimes. Recovery is only ever a targeted
    `wsl --terminate <distro>`, and even that refuses to touch a distro whose
    name matches -ProtectedDistroPattern.
#>
[CmdletBinding()]
param(
    [string] $Distro           = '1helm',
    [string] $Service          = '1helm.service',
    [int]    $HealthPort       = 8123,
    [int]    $PollSeconds      = 10,
    [int]    $DeepCheckEvery   = 6,
    [int]    $MaxDeepFailures  = 6,
    [int]    $HoldInterval     = 20,
    [string] $ProtectedDistroPattern = '-runtime$',
    [string] $LogPath
)

# --- bootstrap -------------------------------------------------------------
$ErrorActionPreference = 'Continue'
$env:WSL_UTF8 = '1'          # make wsl.exe emit UTF-8, not UTF-16LE
$WslExe = Join-Path $env:SystemRoot 'System32\wsl.exe'
if (-not $PSScriptRoot) { $PSScriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path }
if (-not $LogPath) { $LogPath = Join-Path $PSScriptRoot 'keepalive.log' }
$HoldScriptWin = Join-Path $PSScriptRoot 'keepalive-hold.sh'

function Write-Log {
    param([string]$Message, [string]$Level = 'INFO')
    $line = '{0} [{1}] {2}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Level, $Message
    try {
        if ((Test-Path $LogPath) -and ((Get-Item $LogPath).Length -gt 1MB)) {
            Move-Item -Path $LogPath -Destination "$LogPath.1" -Force -ErrorAction SilentlyContinue
        }
        Add-Content -Path $LogPath -Value $line -Encoding UTF8 -ErrorAction SilentlyContinue
    } catch { }
}

function Hide-ConsoleWindow {
    # Belt and braces: the Scheduled Task action already passes -WindowStyle
    # Hidden, this makes sure nothing is left on screen if it is ever launched
    # another way. Child console processes we spawn with -NoNewWindow inherit
    # this (hidden) console, so they stay invisible too.
    try {
        if (-not ('OneHelm.Native' -as [type])) {
            Add-Type -Namespace OneHelm -Name Native -MemberDefinition @'
[DllImport("kernel32.dll")] public static extern System.IntPtr GetConsoleWindow();
[DllImport("user32.dll")]   public static extern bool ShowWindow(System.IntPtr hWnd, int nCmdShow);
'@
        }
        $h = [OneHelm.Native]::GetConsoleWindow()
        if ($h -ne [IntPtr]::Zero) { [void][OneHelm.Native]::ShowWindow($h, 0) }
    } catch { }
}

function ConvertTo-WslPath {
    param([string]$WindowsPath)
    $full = [System.IO.Path]::GetFullPath($WindowsPath)
    '/mnt/' + $full.Substring(0, 1).ToLowerInvariant() + ($full.Substring(2) -replace '\\', '/')
}

function Test-DistroRunning {
    try {
        $raw = (& $WslExe --list --running --quiet 2>$null | Out-String) -replace "`0", ''
        foreach ($l in ($raw -split "`r?`n")) { if ($l.Trim() -eq $Distro) { return $true } }
    } catch { }
    return $false
}

function Test-Health {
    try {
        $r = Invoke-WebRequest -Uri ("http://localhost:{0}/" -f $HealthPort) `
                               -UseBasicParsing -TimeoutSec 8 -ErrorAction Stop
        return ($r.StatusCode -ge 200 -and $r.StatusCode -lt 500)
    } catch { return $false }
}

$AnchorOut = Join-Path $PSScriptRoot 'anchor.out.log'
$AnchorErr = Join-Path $PSScriptRoot 'anchor.err.log'
$AnchorIn  = Join-Path $PSScriptRoot 'anchor.stdin'

function ConvertTo-WslArg {
    # wsl.exe does NOT strip surrounding double quotes from its own option
    # values: `wsl -d "my-distro"` fails with WSL_E_DISTRO_NOT_FOUND because it
    # looks for a distro whose name literally includes the quote characters.
    # So quote only when there is whitespace that actually needs it.
    param([string]$Value)
    if ($Value -match '\s') { return '"' + $Value + '"' }
    return $Value
}

function Start-Anchor {
    $holdWsl = ConvertTo-WslPath $HoldScriptWin
    $argLine = '-d {0} -u root --exec /bin/sh {1} {2} {3}' -f `
               (ConvertTo-WslArg $Distro), (ConvertTo-WslArg $holdWsl), (ConvertTo-WslArg $Service), $HoldInterval

    # wsl.exe requires VALID standard handles. If the supervisor was itself
    # started without a console or with broken handles (Win32_Process.Create,
    # some task hosts, service wrappers), the inherited handles are invalid and
    # wsl.exe dies instantly with no message - which looks exactly like "the
    # distro refuses to boot". Redirecting all three streams to real files makes
    # the anchor behave identically in every host context, and captures the
    # anchor's own stderr so a failure is diagnosable instead of silent.
    if (-not (Test-Path $AnchorIn)) { New-Item -ItemType File -Path $AnchorIn -Force | Out-Null }
    foreach ($f in @($AnchorOut, $AnchorErr)) {
        if ((Test-Path $f) -and ((Get-Item $f).Length -gt 256KB)) { Remove-Item $f -Force -ErrorAction SilentlyContinue }
    }

    $p = Start-Process -FilePath $WslExe -ArgumentList $argLine -NoNewWindow -PassThru `
            -RedirectStandardInput $AnchorIn `
            -RedirectStandardOutput $AnchorOut `
            -RedirectStandardError $AnchorErr
    Write-Log ("anchor started: wsl.exe pid={0} -> {1}" -f $p.Id, $holdWsl)
    return $p
}

function Get-AnchorError {
    foreach ($f in @($AnchorErr, $AnchorOut)) {
        if (Test-Path $f) {
            $t = (Get-Content $f -Tail 3 -ErrorAction SilentlyContinue) -join ' | '
            if ($t -and $t.Trim()) { return $t.Trim() }
        }
    }
    return '(no output captured)'
}

function Stop-Anchor {
    param($Proc)
    if ($null -ne $Proc) {
        try { if (-not $Proc.HasExited) { Stop-Process -Id $Proc.Id -Force -ErrorAction SilentlyContinue } } catch { }
    }
    # wsl.exe re-execs itself; sweep any orphan anchors for THIS distro only.
    try {
        Get-CimInstance Win32_Process -Filter "Name='wsl.exe'" -ErrorAction SilentlyContinue |
            Where-Object { $_.CommandLine -and $_.CommandLine -like '*keepalive-hold.sh*' -and $_.CommandLine -like "*$Distro*" } |
            ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    } catch { }
}

function Restart-Distro {
    # SAFETY: targeted terminate only. `wsl --shutdown` is never used anywhere
    # in this project - it would kill every distro for every user on the box.
    if ([string]::IsNullOrWhiteSpace($Distro) -or $Distro -match $ProtectedDistroPattern) {
        Write-Log "REFUSING to terminate protected/blank distro '$Distro'" 'ERROR'
        return
    }
    Write-Log "terminating distro '$Distro' to recover it" 'WARN'
    try { & $WslExe --terminate $Distro 2>&1 | Out-Null } catch { Write-Log "terminate failed: $_" 'ERROR' }
    Start-Sleep -Seconds 3
}

# --- single instance -------------------------------------------------------
# Local\ (per-session) is exactly the right scope: one holder per logon session,
# and it needs no privilege, unlike Global\.
$mutexName = "Local\1Helm-Keepalive-$Distro"
$mutex = New-Object System.Threading.Mutex($false, $mutexName)
$owned = $false
try { $owned = $mutex.WaitOne(0) } catch [System.Threading.AbandonedMutexException] { $owned = $true }
if (-not $owned) {
    Write-Log "another supervisor already holds $mutexName - exiting (single-instance guard)" 'WARN'
    exit 0
}

Hide-ConsoleWindow
Write-Log "=== supervisor start === pid=$PID user=$env:USERNAME session=$([System.Diagnostics.Process]::GetCurrentProcess().SessionId) distro=$Distro service=$Service"

if (-not (Test-Path $HoldScriptWin)) {
    Write-Log "anchor script missing: $HoldScriptWin" 'ERROR'
    exit 1
}

# --- main loop -------------------------------------------------------------
$anchor    = $null
$tick      = 0
$deepFail  = 0
try {
    while ($true) {
        try {
            if ($null -eq $anchor -or $anchor.HasExited) {
                if ($null -ne $anchor) {
                    Write-Log ("anchor pid={0} exited (code={1}) - respawning. anchor output: {2}" -f `
                               $anchor.Id, $anchor.ExitCode, (Get-AnchorError)) 'WARN'
                }
                $anchor = Start-Anchor
                Start-Sleep -Seconds 5
            }

            $tick++
            if (($tick % $DeepCheckEvery) -eq 0) {
                $running = Test-DistroRunning
                $healthy = $running -and (Test-Health)
                if ($healthy) {
                    if ($deepFail -gt 0) { Write-Log "recovered: distro running and :$HealthPort answering" }
                    $deepFail = 0
                } else {
                    $deepFail++
                    Write-Log ("health check FAILED #{0} (distroRunning={1})" -f $deepFail, $running) 'WARN'
                    # Do not restart a unit that is still coming up. A cold distro
                    # boot plus 1Helm's own start took 33-80s on an 8-core test box
                    # and will be slower on modest hardware, so an unconditional
                    # restart here interrupts the very startup we are waiting for.
                    # "activating" means systemd is working on it; leave it alone.
                    if ($running) {
                        $unitState = ''
                        try { $unitState = (& $WslExe -d $Distro -u root --exec /usr/bin/systemctl is-active $Service 2>&1 | Out-String).Trim() } catch { }
                        if ($unitState -match 'activating') {
                            Write-Log "$Service is still activating - waiting rather than restarting it"
                            $deepFail--
                        } else {
                            try { & $WslExe -d $Distro -u root --exec /usr/bin/systemctl restart $Service 2>&1 | Out-Null } catch { }
                        }
                    }
                    if ($deepFail -ge $MaxDeepFailures) {
                        Write-Log "escalating: recycling anchor and distro" 'WARN'
                        Stop-Anchor $anchor
                        $anchor = $null
                        Restart-Distro
                        $deepFail = 0
                    }
                }
            }
        } catch {
            Write-Log "loop error: $($_.Exception.Message)" 'ERROR'
        }
        Start-Sleep -Seconds $PollSeconds
    }
} finally {
    Write-Log "=== supervisor exiting (pid=$PID) ===" 'WARN'
    try { $mutex.ReleaseMutex() } catch { }
    try { $mutex.Dispose() } catch { }
}
