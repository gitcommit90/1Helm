<#
.SYNOPSIS
    Remove the 1Helm WSL keepalive: stop the holder, unregister the task,
    leave nothing behind.

.DESCRIPTION
    Reverses keepalive-install.ps1 completely and non-interactively:
      1. stop + unregister the scheduled task, and delete the \1Helm\ task
         folder if it is left empty;
      2. kill the supervisor (powershell running keepalive-run.ps1);
      3. kill the Windows-side anchor (wsl.exe running keepalive-hold.sh);
      4. kill the in-distro anchor shell, but only if the distro is already
         running - we must not boot it just to clean up;
      5. optionally terminate the distro (-TerminateDistro) and delete the
         install directory (-PurgeFiles).

    Without -TerminateDistro the distro is simply left unheld, and WSL will
    idle it out on its own in ~15 seconds.

.NOTES
    NEVER calls `wsl --shutdown`. -TerminateDistro is a targeted
    `wsl --terminate <distro>` and refuses any distro matching
    -ProtectedDistroPattern (default: anything ending in "-runtime").
#>
[CmdletBinding()]
param(
    [string] $Distro     = '1helm',
    [string] $InstallDir = 'C:\1helm\keepalive',
    [string] $TaskPath   = '\1Helm\',
    [string] $TaskName   = '1Helm-WSL-Keepalive',
    [string] $ProtectedDistroPattern = '-runtime$',
    [switch] $TerminateDistro,
    [switch] $PurgeFiles
)

$ErrorActionPreference = 'Continue'
$env:WSL_UTF8 = '1'
$WslExe = Join-Path $env:SystemRoot 'System32\wsl.exe'
function Say { param([string]$m, [string]$c = 'Gray') Write-Host $m -ForegroundColor $c }

Say "Removing 1Helm WSL keepalive for distro '$Distro'" 'Cyan'

# 1. scheduled task ---------------------------------------------------------
$task = Get-ScheduledTask -TaskPath $TaskPath -TaskName $TaskName -ErrorAction SilentlyContinue
if ($task) {
    try { Stop-ScheduledTask -TaskPath $TaskPath -TaskName $TaskName -ErrorAction SilentlyContinue } catch { }
    Unregister-ScheduledTask -TaskPath $TaskPath -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
    Say "  unregistered $TaskPath$TaskName" 'Green'
} else {
    Say "  no task $TaskPath$TaskName (already gone)"
}
# drop the \1Helm\ folder if we left it empty
try {
    $svc = New-Object -ComObject Schedule.Service
    $svc.Connect()
    $leaf = $TaskPath.Trim('\')
    if ($leaf) {
        $root = $svc.GetFolder('\')
        $sub  = $root.GetFolder($leaf)
        if ($sub.GetTasks(1).Count -eq 0 -and $sub.GetFolders(0).Count -eq 0) {
            $root.DeleteFolder($leaf, 0)
            Say "  removed empty task folder $TaskPath" 'Green'
        }
    }
} catch { }

# 2. supervisor -------------------------------------------------------------
$sup = Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue |
       Where-Object { $_.CommandLine -like '*keepalive-run.ps1*' -and $_.ProcessId -ne $PID }
foreach ($p in $sup) { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue; Say "  killed supervisor pid $($p.ProcessId)" 'Green' }
if (-not $sup) { Say "  no supervisor running" }

# 3. Windows-side anchor ----------------------------------------------------
$anch = Get-CimInstance Win32_Process -Filter "Name='wsl.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -like '*keepalive-hold.sh*' }
foreach ($p in $anch) { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue; Say "  killed anchor pid $($p.ProcessId)" 'Green' }
if (-not $anch) { Say "  no anchor running" }

# 4. in-distro anchor - only if the distro is already up --------------------
$running = $false
try {
    $raw = (& $WslExe --list --running --quiet 2>$null | Out-String) -replace "`0", ''
    foreach ($l in ($raw -split "`r?`n")) { if ($l.Trim() -eq $Distro) { $running = $true } }
} catch { }
if ($running) {
    try {
        & $WslExe -d $Distro -u root --exec /usr/bin/pkill -f keepalive-hold.sh 2>&1 | Out-Null
        Say "  cleaned in-distro anchor shell" 'Green'
    } catch { }
} else {
    Say "  distro '$Distro' is not running - nothing to clean inside it"
}

# 5. optional distro terminate ---------------------------------------------
if ($TerminateDistro) {
    if ([string]::IsNullOrWhiteSpace($Distro) -or $Distro -match $ProtectedDistroPattern) {
        Say "  REFUSING to terminate protected distro '$Distro'" 'Red'
    } else {
        & $WslExe --terminate $Distro 2>&1 | Out-Null      # never --shutdown
        Say "  terminated distro '$Distro'" 'Green'
    }
}

# 6. optional file purge ----------------------------------------------------
foreach ($f in 'keepalive.log', 'keepalive.log.1', 'anchor.out.log', 'anchor.err.log', 'anchor.stdin') {
    Remove-Item (Join-Path $InstallDir $f) -Force -ErrorAction SilentlyContinue
}
if ($PurgeFiles) {
    if ($PSScriptRoot -and ($PSScriptRoot.TrimEnd('\') -ieq $InstallDir.TrimEnd('\'))) {
        # We are running from inside the directory we are deleting; schedule it.
        $cmd = 'Start-Sleep -Seconds 3; Remove-Item -LiteralPath "{0}" -Recurse -Force -ErrorAction SilentlyContinue' -f $InstallDir
        Start-Process -FilePath (Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe') `
                      -ArgumentList ('-NoProfile -WindowStyle Hidden -Command "{0}"' -f $cmd) -WindowStyle Hidden
        Say "  install directory will be deleted in 3s: $InstallDir" 'Green'
    } else {
        Remove-Item -LiteralPath $InstallDir -Recurse -Force -ErrorAction SilentlyContinue
        Say "  deleted $InstallDir" 'Green'
    }
}

# --- residual state report -------------------------------------------------
Say "" 
Say "Residual state:" 'Cyan'
$t = Get-ScheduledTask -TaskPath $TaskPath -TaskName $TaskName -ErrorAction SilentlyContinue
Say ("  scheduled task      : {0}" -f $(if ($t) { 'STILL PRESENT' } else { 'gone' }))
$s = @(Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -EA SilentlyContinue | Where-Object { $_.CommandLine -like '*keepalive-run.ps1*' -and $_.ProcessId -ne $PID })
Say ("  supervisor processes: {0}" -f $s.Count)
$a = @(Get-CimInstance Win32_Process -Filter "Name='wsl.exe'" -EA SilentlyContinue | Where-Object { $_.CommandLine -like '*keepalive-hold.sh*' })
Say ("  anchor processes    : {0}" -f $a.Count)
Say "Done." 'Green'
