$ErrorActionPreference = "Stop"

if (-not (Get-Command wsl.exe -ErrorAction SilentlyContinue)) {
  throw "WSL is unavailable. Enable the Windows Subsystem for Linux and virtualization first."
}

$distros = @(wsl.exe --list --quiet | ForEach-Object { $_.Trim([char]0).Trim() } | Where-Object { $_ })
if ($distros -notcontains "Ubuntu") {
  Write-Host "Installing Ubuntu for 1Helm..."
  wsl.exe --install -d Ubuntu
  Write-Host "Ubuntu was installed. Finish its first-run user creation if prompted, then run this script again."
  exit 0
}

$systemd = (wsl.exe -d Ubuntu -- bash -lc "ps -p 1 -o comm=" 2>$null).Trim()
if ($systemd -ne "systemd") {
  Write-Host "Enabling systemd inside Ubuntu..."
  wsl.exe -d Ubuntu -u root -- bash -lc "printf '[boot]\nsystemd=true\n' > /etc/wsl.conf"
  wsl.exe --shutdown
  Start-Sleep -Seconds 3
}

Write-Host "Installing 1Helm's durable Linux service inside WSL..."
wsl.exe -d Ubuntu -u root -- bash -lc "curl -fsSLo /tmp/1helm-install.sh https://1helm.com/install.sh && bash /tmp/1helm-install.sh"
if ($LASTEXITCODE -ne 0) { throw "The 1Helm Linux installer failed inside WSL." }

Write-Host "1Helm is available at http://localhost:8123"
Write-Host "WSL must be running for scheduled work. This path does not yet provide one isolated VM per resident."
