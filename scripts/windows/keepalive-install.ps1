<#
.SYNOPSIS
    Install the 1Helm WSL keepalive as a per-user Scheduled Task and start it.

.DESCRIPTION
    Registers "\1Helm\1Helm-WSL-Keepalive" running as the *signed-in user*
    (LogonType Interactive, RunLevel Limited):

      Trigger 1  At logon of this user          -> requirement 1
      Trigger 2  Every 1 minute, indefinitely   -> requirement 3 (crash recovery)
      Settings   MultipleInstances = IgnoreNew  -> requirement 4 (single instance)
                 ExecutionTimeLimit = unlimited (default 72h would kill it)
                 RestartOnFailure 3 x 1 min     -> second recovery layer

    RunLevel Limited + a task owned by the calling user means registration needs
    no administrator rights and raises no UAC prompt.

    Idempotent: safe to run repeatedly. It tears down any previous supervisor
    and anchor first, so a second run replaces rather than stacks.

    -Unattended switches the principal to LogonType S4U ("run whether the user
    is logged on or not", no stored password). Still the user's own account, so
    WSL state stays user-scoped - it is NOT Local System - but there is no
    interactive desktop. Only for kiosk/headless boxes where nobody signs in.

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File .\keepalive-install.ps1

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File .\keepalive-install.ps1 -Unattended
#>
[CmdletBinding()]
param(
    [string] $Distro     = '1helm',
    [string] $Service    = '1helm.service',
    [int]    $HealthPort = 8123,
    [string] $InstallDir = 'C:\1helm\keepalive',
    [string] $TaskPath   = '\1Helm\',
    [string] $TaskName   = '1Helm-WSL-Keepalive',
    [int]    $WaitSeconds = 180,
    [switch] $Unattended
)

$ErrorActionPreference = 'Stop'
$env:WSL_UTF8 = '1'

function Say { param([string]$m, [string]$c = 'Gray') Write-Host $m -ForegroundColor $c }

# --- guard: never Local System -------------------------------------------
$me  = [Security.Principal.WindowsIdentity]::GetCurrent()
if ($me.User.Value -eq 'S-1-5-18' -or $me.Name -match 'NT AUTHORITY') {
    throw "REFUSING to install as '$($me.Name)'. 1Helm's WSL backend is user-scoped; the keepalive must run as the signed-in user, never as Local System."
}
$userId = $me.Name                                  # DOMAIN\user
Say "Installing 1Helm WSL keepalive as: $userId" 'Cyan'

# --- lay down the payload -------------------------------------------------
if (-not $PSScriptRoot) { $PSScriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path }
$null = New-Item -ItemType Directory -Path $InstallDir -Force

foreach ($f in 'keepalive-run.ps1', 'keepalive-hold.sh', 'keepalive-remove.ps1') {
    $src = Join-Path $PSScriptRoot $f
    $dst = Join-Path $InstallDir  $f
    if ((Test-Path $src) -and ($src -ne $dst)) { Copy-Item $src $dst -Force }
    if (-not (Test-Path $dst)) { throw "missing required file: $dst" }
}

# bash will not tolerate CRLF in a shebang script - force LF, no BOM.
$holdDst = Join-Path $InstallDir 'keepalive-hold.sh'
$txt = [IO.File]::ReadAllText($holdDst) -replace "`r`n", "`n"
[IO.File]::WriteAllText($holdDst, $txt, (New-Object Text.UTF8Encoding($false)))
Say "Payload installed in $InstallDir"

$runScript = Join-Path $InstallDir 'keepalive-run.ps1'

# --- tear down anything already running (no stacking) ---------------------
$existing = Get-ScheduledTask -TaskPath $TaskPath -TaskName $TaskName -ErrorAction SilentlyContinue
if ($existing) {
    Say "Existing task found - stopping and replacing it" 'Yellow'
    try { Stop-ScheduledTask -TaskPath $TaskPath -TaskName $TaskName -ErrorAction SilentlyContinue } catch { }
    try { Unregister-ScheduledTask -TaskPath $TaskPath -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue } catch { }
}
Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like '*keepalive-run.ps1*' -and $_.ProcessId -ne $PID } |
    ForEach-Object { Say "  killing stale supervisor pid $($_.ProcessId)"; Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Get-CimInstance Win32_Process -Filter "Name='wsl.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like '*keepalive-hold.sh*' } |
    ForEach-Object { Say "  killing stale anchor pid $($_.ProcessId)"; Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

# --- build and register the task -----------------------------------------
$psExe = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$argLine = '-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "{0}" -Distro "{1}" -Service "{2}" -HealthPort {3}' -f `
           $runScript, $Distro, $Service, $HealthPort

$action = New-ScheduledTaskAction -Execute $psExe -Argument $argLine -WorkingDirectory $InstallDir

$trgLogon = New-ScheduledTaskTrigger -AtLogOn -User $userId

# "Repeat every 1 minute, indefinitely". Note: -RepetitionDuration
# ([TimeSpan]::MaxValue) serializes to P99999999DT23H59M59S and the Task
# Scheduler rejects it outright. A *null* Duration is the encoding for
# "indefinitely", so build the trigger with a throwaway duration and clear it.
$trgRepeat = New-ScheduledTaskTrigger -Once -At (Get-Date).Date `
                -RepetitionInterval (New-TimeSpan -Minutes 1) `
                -RepetitionDuration (New-TimeSpan -Days 1)
$trgRepeat.Repetition.Duration          = $null
$trgRepeat.Repetition.StopAtDurationEnd = $false

$triggers = @($trgLogon, $trgRepeat)
if ($Unattended) { $triggers += (New-ScheduledTaskTrigger -AtStartup) }

# Default: InteractiveToken. The task runs only while the user is signed in,
# which is exactly right for the browser-GUI model - no signed-in user means no
# browser to serve, and it guarantees we can never end up running as SYSTEM.
#
# -Unattended: LogonType S4U ("run whether the user is logged on or not",
# *without* a stored password). Still the user's own account and user-scoped WSL
# state - NOT Local System - but it runs in session 0 with no interactive
# desktop. Use only for kiosk/headless boxes where nobody ever signs in.
# Registering S4U needs elevation; the default Interactive path does not.
if ($Unattended) {
    Say "Mode: UNATTENDED (LogonType S4U - runs as $userId with no interactive session)" 'Yellow'
    $principal = New-ScheduledTaskPrincipal -UserId $userId -LogonType S4U -RunLevel Limited
} else {
    $principal = New-ScheduledTaskPrincipal -UserId $userId -LogonType Interactive -RunLevel Limited
}

$settings = New-ScheduledTaskSettingsSet `
    -MultipleInstances IgnoreNew `
    -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -StartWhenAvailable -DontStopOnIdleEnd `
    -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
$settings.DisallowStartOnRemoteAppSession = $false
$settings.Enabled = $true

# Register-ScheduledTask is CIM-backed, so $ErrorActionPreference = 'Stop' does
# NOT make it terminating: without an explicit -ErrorAction it writes an error
# and execution continues, and the script goes on to report success. That
# matters because registration genuinely fails with Access denied (0x80070005)
# when the task folder was created by an elevated process and this run is not
# elevated - a real upgrade path. Never infer registration from the health
# probe below either: a stale task left in place also answers on the port.
try {
    $null = Register-ScheduledTask -TaskPath $TaskPath -TaskName $TaskName `
                -Action $action -Trigger $triggers `
                -Principal $principal -Settings $settings `
                -Description "Holds the $Distro WSL 2 distro open for the signed-in user and keeps $Service active, so http://localhost:$HealthPort stays reachable." `
                -Force -ErrorAction Stop
} catch {
    Say "FAILED to register $TaskPath$TaskName : $($_.Exception.Message)" 'Red'
    if ($_.Exception.Message -match 'Access is denied|0x80070005') {
        Say "The task folder $TaskPath was most likely created by an elevated process." 'Yellow'
        Say "Re-run this installer as Administrator, or remove the existing task first with keepalive-remove.ps1." 'Yellow'
    }
    exit 1
}

# Prove the task actually exists and carries our action before claiming success.
$registered = Get-ScheduledTask -TaskPath $TaskPath -TaskName $TaskName -ErrorAction SilentlyContinue
if (-not $registered) {
    Say "FAILED: $TaskPath$TaskName is not present after registration reported no error." 'Red'
    exit 1
}
Say "Registered scheduled task $TaskPath$TaskName" 'Green'

# --- start it now ---------------------------------------------------------
Start-ScheduledTask -TaskPath $TaskPath -TaskName $TaskName
Say "Task started - waiting up to ${WaitSeconds}s for http://localhost:$HealthPort ..." 'Cyan'

$deadline = (Get-Date).AddSeconds($WaitSeconds)
$ok = $false
while ((Get-Date) -lt $deadline) {
    try {
        $r = Invoke-WebRequest -Uri ("http://localhost:{0}/" -f $HealthPort) -UseBasicParsing -TimeoutSec 5 -ErrorAction Stop
        if ($r.StatusCode -ge 200 -and $r.StatusCode -lt 500) { $ok = $true; break }
    } catch { }
    Start-Sleep -Seconds 3
}

if ($ok) {
    Say "OK: $Distro is up and http://localhost:$HealthPort is answering." 'Green'
} else {
    Say "WARNING: task registered and started, but :$HealthPort did not answer within ${WaitSeconds}s." 'Red'
    Say "         Check $InstallDir\keepalive.log" 'Red'
}
Say "Remove with: powershell -NoProfile -ExecutionPolicy Bypass -File $InstallDir\keepalive-remove.ps1"
if (-not $ok) { exit 1 }
