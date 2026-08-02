<#
.SYNOPSIS
    Remove 1Helm from Windows 11 x64.

.DESCRIPTION
    Reverses install.ps1. 1Helm on Windows is the ordinary Linux build running
    inside a WSL 2 distribution, so removing it means four things, in this order:

      1. stop and unregister the keepalive that holds the distribution open;
      2. run 1Helm's own Linux uninstaller INSIDE the distribution, so it
         removes its containers and systemd units cleanly while it still can;
      3. terminate and unregister the distribution;
      4. delete C:\1helm and the Start Menu entry.

    Usage, from an ordinary PowerShell window signed in as the same Windows user
    that installed 1Helm:

        irm https://1helm.com/uninstall.ps1 | iex

    THIS DESTROYS DATA. Unregistering the distribution deletes its virtual disk,
    and every channel's files, the workspace database, provider credentials and
    resident memory live on that disk. There is no undo and nothing is copied to
    Windows first. The script asks for typed confirmation before it starts; pass
    -Force to skip the prompt for scripted use.

    Every step is idempotent: running this twice, or running it on a PC where
    1Helm was never installed, is safe and simply reports that there was nothing
    to do.

.PARAMETER Distro
    The WSL distribution to remove. Must match an existing distribution name
    exactly, character for character, or nothing is unregistered.

.PARAMETER Force
    Skip the typed confirmation. For scripted and unattended removal.

.NOTES
    This script NEVER calls `wsl --shutdown`. That stops every distribution for
    every user on the machine, including other people's work that has nothing to
    do with 1Helm. Recovery and removal are only ever a targeted
    `wsl --terminate <distro>` and `wsl --unregister <distro>`, and both refuse a
    blank name, a name matching -ProtectedDistroPattern, or any name that is not
    an exact match for a currently registered distribution.

.EXAMPLE
    irm https://1helm.com/uninstall.ps1 | iex

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File .\uninstall.ps1 -Force
#>
[CmdletBinding()]
param(
    [string] $Distro      = '1helm',
    [string] $InstallRoot = 'C:\1helm',
    [string] $TaskPath    = '\1Helm\',
    [string] $TaskName    = '1Helm-WSL-Keepalive',
    [string] $ProtectedDistroPattern = '-runtime$',
    [switch] $Force
)

# A removal must keep going and report honestly rather than stop at the first
# thing that is already gone. Every step below checks its own outcome.
$ErrorActionPreference = 'Continue'
$env:WSL_UTF8 = '1'

$WslExe = Join-Path $env:SystemRoot 'System32\wsl.exe'

function Say  { param([string]$m, [string]$c = 'Gray') Write-Host $m -ForegroundColor $c }
function Step { param([string]$m) Write-Host "==> $m" -ForegroundColor Cyan }
function Die  { param([string]$m) Write-Host "" ; Write-Host "1Helm removal stopped: $m" -ForegroundColor Red ; exit 1 }

# $Kept is strictly "still on this machine after we finished", because that is
# what a person needs to act on. Anything that went wrong but left nothing behind
# is a warning, not residue.
$Removed  = New-Object System.Collections.Generic.List[string]
$Kept     = New-Object System.Collections.Generic.List[string]
$Warnings = New-Object System.Collections.Generic.List[string]
function Add-Removed { param([string]$m) $Removed.Add($m) }
function Add-Kept    { param([string]$m) $Kept.Add($m) }
function Add-Warning { param([string]$m) $Warnings.Add($m) }

# wsl.exe does not strip quotes from its own option values: `wsl -d "name"`
# looks for a distribution whose name literally contains the quotes. Quote only
# when whitespace genuinely requires it.
function ConvertTo-WslArg { param([string]$v) if ($v -match '\s') { return '"' + $v + '"' } return $v }

function Get-Distros {
    try {
        $raw = (& $WslExe --list --quiet 2>$null | Out-String) -replace "`0", ''
        return @($raw -split "`r?`n" | ForEach-Object { $_.Trim() } | Where-Object { $_ })
    } catch { return @() }
}

function Test-DistroRunning {
    try {
        $raw = (& $WslExe --list --running --quiet 2>$null | Out-String) -replace "`0", ''
        foreach ($l in ($raw -split "`r?`n")) { if ($l.Trim() -ceq $Distro) { return $true } }
    } catch { }
    return $false
}

# SAFETY GATE. Nothing destructive touches a distribution that does not pass
# this, and the failure is reported rather than worked around. The same three
# checks the keepalive supervisor uses before its targeted terminate, plus an
# exact, case-sensitive match against the live registration list - so a typo, a
# similarly named distribution, or an empty -Distro can never take out somebody
# else's runtime.
function Test-SafeTarget {
    param([string]$Name)
    if ([string]::IsNullOrWhiteSpace($Name)) {
        Say "    REFUSING to act on a blank distribution name" 'Red'
        return $false
    }
    if ($Name -match $ProtectedDistroPattern) {
        Say "    REFUSING to act on protected distribution '$Name' (matches $ProtectedDistroPattern)" 'Red'
        return $false
    }
    $exact = @(Get-Distros | Where-Object { $_ -ceq $Name })
    if ($exact.Count -ne 1) {
        Say "    REFUSING to act on '$Name': it is not an exact match for one registered distribution" 'Red'
        return $false
    }
    return $true
}

# ---------------------------------------------------------------------------
# Guards
# ---------------------------------------------------------------------------
Write-Host ""
Say "Remove 1Helm for Windows" 'White'
Write-Host ""

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
if ($identity.User.Value -eq 'S-1-5-18' -or $identity.Name -match '^NT AUTHORITY') {
    Die "this must run as your own Windows account, not as $($identity.Name). 1Helm's WSL state is per-user, so a SYSTEM session cannot see - or remove - the distribution that belongs to you."
}

$distroPresent    = ((Get-Distros) -contains $Distro)
$installRootThere = (Test-Path -LiteralPath $InstallRoot)
$taskThere        = ($null -ne (Get-ScheduledTask -TaskPath $TaskPath -TaskName $TaskName -ErrorAction SilentlyContinue))

if (-not $distroPresent -and -not $installRootThere -and -not $taskThere) {
    Say "Nothing to remove: no '$Distro' distribution, no $InstallRoot, no $TaskPath$TaskName." 'Green'
    Say "1Helm is not installed for $($identity.Name)." 'Green'
    Write-Host ""
    exit 0
}

# ---------------------------------------------------------------------------
# Confirmation
# ---------------------------------------------------------------------------
if (-not $Force) {
    Say "This permanently deletes:" 'Yellow'
    Say "  - the WSL distribution '$Distro' and its whole virtual disk;" 'Yellow'
    Say "  - every channel's files and workspace, including anything a resident made;" 'Yellow'
    Say "  - the 1Helm database: accounts, channels, threads, memory and activity;" 'Yellow'
    Say "  - the provider accounts and API keys stored on this machine;" 'Yellow'
    Say "  - $InstallRoot and the Start Menu shortcut." 'Yellow'
    Write-Host ""
    Say "Nothing is backed up and there is no undo. Copy out anything you want to" 'Yellow'
    Say "keep first - open http://localhost:8123 and download it." 'Yellow'
    Write-Host ""
    $answer = ''
    try { $answer = Read-Host "Type  remove  to continue, or press Enter to cancel" } catch {
        Die "this host cannot ask for confirmation, and a removal this destructive is never assumed. Run it again from an ordinary PowerShell window, or add -Force if you are certain."
    }
    if ($answer.Trim().ToLowerInvariant() -ne 'remove') {
        Write-Host ""
        Say "Cancelled. Nothing was changed." 'Green'
        Write-Host ""
        exit 0
    }
    Write-Host ""
}

# ---------------------------------------------------------------------------
# 1. The keepalive
# ---------------------------------------------------------------------------
# First, because it exists to hold the distribution open and to restart
# 1helm.service whenever it stops. Leaving it running would fight every step
# below.
Step "Stopping the 1Helm keepalive"
$keepaliveDir    = Join-Path $InstallRoot 'keepalive'
$keepaliveRemove = Join-Path $keepaliveDir 'keepalive-remove.ps1'
$keepaliveDone   = $false

if (Test-Path -LiteralPath $keepaliveRemove) {
    # The keepalive owns its own teardown, including its scheduled task, its
    # supervisor, both anchors and its task folder. Deliberately without
    # -TerminateDistro: the Linux uninstaller still has to run inside it.
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $keepaliveRemove `
        -Distro $Distro -InstallDir $keepaliveDir -TaskPath $TaskPath -TaskName $TaskName | Out-Host
    if ($LASTEXITCODE -eq 0) {
        $keepaliveDone = $true
        Add-Removed "keepalive (via its own keepalive-remove.ps1)"
    } else {
        Say "    keepalive-remove.ps1 exited $LASTEXITCODE - removing the task directly instead" 'Yellow'
    }
}

if (-not $keepaliveDone) {
    # No keepalive-remove.ps1 on disk, or it failed. Do the same work here so a
    # partial or hand-deleted install still ends up clean.
    if ($taskThere) {
        try { Stop-ScheduledTask -TaskPath $TaskPath -TaskName $TaskName -ErrorAction SilentlyContinue } catch { }
        Unregister-ScheduledTask -TaskPath $TaskPath -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
        if ($null -eq (Get-ScheduledTask -TaskPath $TaskPath -TaskName $TaskName -ErrorAction SilentlyContinue)) {
            Say "    unregistered $TaskPath$TaskName" 'Green'
            Add-Removed "scheduled task $TaskPath$TaskName"
        } else {
            Say "    could not unregister $TaskPath$TaskName" 'Yellow'
            Add-Kept "scheduled task $TaskPath$TaskName"
        }
    } else {
        Say "    no scheduled task $TaskPath$TaskName"
    }

    # Drop the \1Helm\ task folder if this left it empty.
    try {
        $svc = New-Object -ComObject Schedule.Service
        $svc.Connect()
        $leaf = $TaskPath.Trim('\')
        if ($leaf) {
            $root = $svc.GetFolder('\')
            $sub  = $root.GetFolder($leaf)
            if ($sub.GetTasks(1).Count -eq 0 -and $sub.GetFolders(0).Count -eq 0) {
                $root.DeleteFolder($leaf, 0)
                Say "    removed empty task folder $TaskPath" 'Green'
            }
        }
    } catch { }

    # The supervisor and the Windows-side anchor outlive their task.
    $sup = @(Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue |
             Where-Object { $_.CommandLine -like '*keepalive-run.ps1*' -and $_.ProcessId -ne $PID })
    foreach ($p in $sup) { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue }
    if ($sup.Count -gt 0) { Say "    stopped $($sup.Count) keepalive supervisor process(es)" 'Green' }

    $anch = @(Get-CimInstance Win32_Process -Filter "Name='wsl.exe'" -ErrorAction SilentlyContinue |
              Where-Object { $_.CommandLine -like '*keepalive-hold.sh*' -and $_.CommandLine -like "*$Distro*" })
    foreach ($p in $anch) { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue }
    if ($anch.Count -gt 0) { Say "    stopped $($anch.Count) keepalive anchor process(es)" 'Green' }

    if ($taskThere -or $sup.Count -gt 0 -or $anch.Count -gt 0) { Add-Removed "keepalive task and processes" }
}

# ---------------------------------------------------------------------------
# 2. 1Helm's own Linux uninstaller, inside the distribution
# ---------------------------------------------------------------------------
# It knows its installation id, so it deletes only the containers and units that
# belong to this installation, and it does the ownership checks that a blunt
# `wsl --unregister` cannot. Running it first means the distribution is discarded
# already empty rather than mid-flight.
Step "Removing 1Helm inside the '$Distro' distribution"
if (-not $distroPresent) {
    Say "    distribution '$Distro' is not registered - nothing to run inside it"
} else {
    $d = ConvertTo-WslArg $Distro
    & $WslExe -d $d -u root --exec /bin/sh -c 'test -x /opt/1helm/uninstall-host.sh' 2>&1 | Out-Null
    if ($LASTEXITCODE -eq 0) {
        # systemd may still be coming up if WSL had to cold-boot the distribution
        # for this call. The Linux uninstaller tolerates a missing systemctl, but
        # it removes its units far more cleanly when systemd is actually there.
        for ($i = 0; $i -lt 15; $i++) {
            $init = (& $WslExe -d $d -u root --exec /bin/sh -c 'ps -p 1 -o comm=' 2>&1 | Out-String).Trim()
            if ($init -match 'systemd') { break }
            Start-Sleep -Seconds 2
        }
        Say "    running /opt/1helm/uninstall-host.sh ..."
        & $WslExe -d $d -u root --exec /bin/bash /opt/1helm/uninstall-host.sh | Out-Host
        if ($LASTEXITCODE -eq 0) {
            Say "    the Linux uninstaller finished" 'Green'
            Add-Removed "1Helm's Linux services and owned channel containers"
        } else {
            Say "    the Linux uninstaller exited $LASTEXITCODE - continuing" 'Yellow'
            Say "    the distribution is discarded next, so its contents go with it either way" 'DarkGray'
            Add-Warning "uninstall-host.sh exited $LASTEXITCODE inside the distribution; its output is above. Nothing was left on Windows by this."
        }
    } else {
        Say "    /opt/1helm/uninstall-host.sh is not present - the install did not get that far"
    }
}

# ---------------------------------------------------------------------------
# 3. The distribution
# ---------------------------------------------------------------------------
Step "Removing the '$Distro' distribution"
if (-not $distroPresent) {
    Say "    already gone"
} elseif (-not (Test-SafeTarget $Distro)) {
    Say "    the distribution was left completely untouched" 'Yellow'
    Add-Kept "WSL distribution '$Distro' (failed the exact-name safety check)"
} else {
    # Targeted terminate only - never `wsl --shutdown`, which would stop every
    # distribution on this machine for every user.
    if (Test-DistroRunning) {
        & $WslExe --terminate $Distro 2>&1 | Out-Null
        Start-Sleep -Seconds 2
        Say "    terminated '$Distro'" 'Green'
    } else {
        Say "    '$Distro' is not running"
    }

    & $WslExe --unregister $Distro 2>&1 | Out-Host
    if ((Get-Distros) -contains $Distro) {
        Say "    '$Distro' is STILL registered" 'Red'
        Add-Kept "WSL distribution '$Distro' (wsl --unregister did not remove it)"
    } else {
        Say "    unregistered '$Distro' and deleted its virtual disk" 'Green'
        Add-Removed "WSL distribution '$Distro' and all of its data"
    }
}

# ---------------------------------------------------------------------------
# 4. Windows-side files and shortcuts
# ---------------------------------------------------------------------------
Step "Removing Windows files and shortcuts"

$programs = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'
foreach ($leaf in '1Helm.url', '1Helm.lnk') {
    $shortcut = Join-Path $programs $leaf
    if (Test-Path -LiteralPath $shortcut) {
        Remove-Item -LiteralPath $shortcut -Force -ErrorAction SilentlyContinue
        if (Test-Path -LiteralPath $shortcut) {
            Say "    could not remove $shortcut" 'Yellow'
            Add-Kept "Start Menu $leaf"
        } else {
            Say "    removed Start Menu $leaf" 'Green'
            Add-Removed "Start Menu $leaf"
        }
    }
}

if (Test-Path -LiteralPath $InstallRoot) {
    Remove-Item -LiteralPath $InstallRoot -Recurse -Force -ErrorAction SilentlyContinue
    if (Test-Path -LiteralPath $InstallRoot) {
        # Almost always because this script, or a copy of install.ps1, is being
        # read from inside the directory being deleted. Hand the last step to a
        # detached process that starts after this one has let go.
        $cmd = 'Start-Sleep -Seconds 5; Remove-Item -LiteralPath "{0}" -Recurse -Force -ErrorAction SilentlyContinue' -f $InstallRoot
        try {
            Start-Process -FilePath (Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe') `
                          -ArgumentList ('-NoProfile -WindowStyle Hidden -Command "{0}"' -f $cmd) -WindowStyle Hidden
            Say "    $InstallRoot is in use; it will be deleted in a few seconds" 'Yellow'
            Add-Removed "$InstallRoot (deletion scheduled - it was still in use)"
        } catch {
            Say "    could not remove $InstallRoot - delete it yourself" 'Yellow'
            Add-Kept $InstallRoot
        }
    } else {
        Say "    removed $InstallRoot" 'Green'
        Add-Removed $InstallRoot
    }
} else {
    Say "    no $InstallRoot"
}

# ---------------------------------------------------------------------------
# Report
# ---------------------------------------------------------------------------
# Deliberately not removed: the Windows optional features (WSL and
# VirtualMachinePlatform) and Microsoft's WSL package. They are Microsoft
# components that other distributions may depend on, and turning them off needs
# administrator rights and another restart.
Write-Host ""
Say "Removed:" 'Cyan'
if ($Removed.Count -eq 0) { Say "  (nothing)" } else { foreach ($r in $Removed) { Say "  - $r" 'Green' } }

Write-Host ""
if ($Kept.Count -eq 0) {
    Say "Nothing was left behind." 'Green'
} else {
    Say "Could NOT remove:" 'Yellow'
    foreach ($k in $Kept) { Say "  - $k" 'Yellow' }
}

if ($Warnings.Count -gt 0) {
    Write-Host ""
    Say "Worth knowing:" 'Yellow'
    foreach ($w in $Warnings) { Say "  - $w" 'Yellow' }
}

Write-Host ""
Say "Windows' own WSL feature and Microsoft's WSL package were left installed." 'DarkGray'
Say "Other distributions on this PC were not touched." 'DarkGray'
Write-Host ""
if ($Kept.Count -gt 0) { exit 1 }
exit 0
