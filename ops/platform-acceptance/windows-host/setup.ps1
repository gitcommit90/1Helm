$ErrorActionPreference = "Stop"
$root = "C:\1HelmAcceptance"
New-Item -ItemType Directory -Force -Path $root | Out-Null
$log = Join-Path $root "bootstrap.log"
Start-Transcript -Path $log -Append
try {
  if (Test-Path (Join-Path $root "ready.json")) { exit 0 }

  $virtio = Get-Volume | Where-Object { $_.DriveLetter -and (Test-Path ("{0}:\guest-agent\qemu-ga-x86_64.msi" -f $_.DriveLetter)) } | Select-Object -First 1
  if (-not $virtio) { throw "VirtIO 0.1.271 media was not found." }
  $drive = "{0}:" -f $virtio.DriveLetter
  & pnputil.exe /add-driver "$drive\NetKVM\w11\amd64\*.inf" /subdirs /install
  if ($LASTEXITCODE -notin 0, 3010) { throw "NetKVM driver install failed: $LASTEXITCODE" }
  # The QEMU guest agent reaches the host over a VirtIO serial port. Without
  # this driver the QEMU-GA service still starts and reports Running, while the
  # host side ("qm agent <vmid> ping") stays dead and there is no guest-exec
  # channel to provision the host with.
  & pnputil.exe /add-driver "$drive\vioserial\w11\amd64\*.inf" /subdirs /install
  if ($LASTEXITCODE -notin 0, 3010) { throw "VirtIO serial driver install failed: $LASTEXITCODE" }
  & msiexec.exe /i "$drive\guest-agent\qemu-ga-x86_64.msi" /qn /norestart
  if ($LASTEXITCODE -notin 0, 3010) { throw "QEMU guest agent install failed: $LASTEXITCODE" }

  $capability = Get-WindowsCapability -Online | Where-Object Name -Like "OpenSSH.Server*" | Select-Object -First 1
  if (-not $capability) { throw "Windows did not expose the OpenSSH Server capability." }
  if ($capability.State -ne "Installed") { Add-WindowsCapability -Online -Name $capability.Name | Out-Null }

  New-Item -ItemType Directory -Force -Path "C:\ProgramData\ssh" | Out-Null
  # The authorized key is supplied per site on the bootstrap media rather than
  # committed to this public repository. build-unattend-iso.sh stages it.
  $keySource = Join-Path $PSScriptRoot "authorized_key.pub"
  if (-not (Test-Path $keySource)) { throw "authorized_key.pub is missing from the bootstrap media; see ops/platform-acceptance/windows-host/README.md" }
  $authorizedKey = (Get-Content -Raw $keySource).Trim()
  if ($authorizedKey -notmatch '^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp[0-9]+) ') { throw "authorized_key.pub is not an OpenSSH public key" }
  Set-Content -Encoding ascii -Path "C:\ProgramData\ssh\administrators_authorized_keys" -Value $authorizedKey
  & icacls.exe "C:\ProgramData\ssh\administrators_authorized_keys" /inheritance:r /grant "Administrators:F" /grant "SYSTEM:F" | Out-Null
  $config = "C:\ProgramData\ssh\sshd_config"
  if (Test-Path $config) {
    $text = Get-Content -Raw $config
    $text = [regex]::Replace($text, '(?m)^\s*#?\s*PasswordAuthentication\s+.*$', 'PasswordAuthentication no')
    $text = [regex]::Replace($text, '(?m)^\s*#?\s*PubkeyAuthentication\s+.*$', 'PubkeyAuthentication yes')
    Set-Content -Encoding ascii -Path $config -Value $text
  }
  Set-Service sshd -StartupType Automatic
  Start-Service sshd
  # Add-WindowsCapability already creates OpenSSH-Server-In-TCP, but scoped to
  # the Private profile only. A freshly bridged VM is categorized Public, so a
  # bare existence check short-circuits and leaves port 22 unreachable even
  # though sshd reports Running. Ensure the rule exists AND covers every profile.
  if (Get-NetFirewallRule -Name OpenSSH-Server-In-TCP -ErrorAction SilentlyContinue) {
    Set-NetFirewallRule -Name OpenSSH-Server-In-TCP -Enabled True -Profile Any
  } else {
    New-NetFirewallRule -Name OpenSSH-Server-In-TCP -DisplayName "OpenSSH Server (sshd)" -Enabled True -Direction Inbound -Protocol TCP -Action Allow -LocalPort 22 -Profile Any | Out-Null
  }
  Set-Service QEMU-GA -StartupType Automatic
  Start-Service QEMU-GA
  powercfg.exe /change standby-timeout-ac 0 | Out-Null
  powercfg.exe /change hibernate-timeout-ac 0 | Out-Null
  $record = [ordered]@{ ready = $true; computer = $env:COMPUTERNAME; build = [Environment]::OSVersion.Version.ToString(); at = (Get-Date).ToUniversalTime().ToString("o") }
  Set-Content -Encoding utf8 -Path (Join-Path $root "ready.json") -Value ($record | ConvertTo-Json -Compress)
} finally {
  Stop-Transcript
}
