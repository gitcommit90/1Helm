$ErrorActionPreference = "Stop"
$installerPath = Join-Path (Split-Path -Parent $PSScriptRoot) "scripts\install-wsl-runtime.ps1"
$tokens = $null
$errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($installerPath, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw "install-wsl-runtime.ps1 did not parse: $($errors[0].Message)" }

foreach ($name in @("Read-ReportedSetupStatus", "Get-HostSetupOutcome")) {
  $definition = $ast.FindAll({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name }, $true) | Select-Object -First 1
  if ($null -eq $definition) { throw "Missing $name in the Windows runtime installer." }
  . ([scriptblock]::Create($definition.Extent.Text))
}

$temporary = Join-Path ([System.IO.Path]::GetTempPath()) ("1helm-wsl-status-test-" + [Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $temporary | Out-Null
try {
  $statusPath = Join-Path $temporary "setup-status.json"
  $env:HELM_WSL_SETUP_STATUS = $statusPath
  [System.IO.File]::WriteAllText($statusPath, '{"status":"restart_required","step":"Restart from elevated pass","error":"Reboot boundary","progress":20}', [System.Text.UTF8Encoding]::new($false))
  $restart = Get-HostSetupOutcome -ExitCode 0
  if ($restart.Status -ne "restart_required" -or $restart.Step -ne "Restart from elevated pass" -or $restart.Detail -ne "Reboot boundary") {
    throw "A shared restart_required result was not authoritative over elevated exit code 0."
  }

  [System.IO.File]::WriteAllText($statusPath, '{"status":"failed","step":"Elevated failure","error":"Exact elevated error","progress":0}', [System.Text.UTF8Encoding]::new($false))
  $failed = Get-HostSetupOutcome -ExitCode 0
  if ($failed.Status -ne "failed" -or $failed.Detail -ne "Exact elevated error") {
    throw "A shared elevated failure was not preserved."
  }

  Remove-Item -LiteralPath $statusPath -Force
  $zero = Get-HostSetupOutcome -ExitCode 0
  $ten = Get-HostSetupOutcome -ExitCode 10
  if ($zero.Status -ne "continue" -or $ten.Status -ne "restart_required") {
    throw "Exit-code fallback behavior is invalid."
  }
  Write-Host "Windows WSL shared-status transaction regression passed."
} finally {
  Remove-Item Env:HELM_WSL_SETUP_STATUS -ErrorAction SilentlyContinue
  if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Recurse -Force }
}
