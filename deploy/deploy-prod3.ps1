param(
  [string]$VmHost = "52.165.83.50",
  [string]$VmUser = "azureuser",
  [string]$SshKeyPath = "$env:USERPROFILE\.ssh\id_ed25519_accountibilitymax",
  [string]$FrontendRepoPath = "C:\Users\LocalAccountHPT25\Desktop\newsaas\Contest",
  [string]$FrontendVmDistPath = "/var/www/Contest/dist",
  [string]$FrontendVmTempPath = "/tmp/contest-dist-new",
  [string]$BackendServerJsLocalPath = "C:\Users\LocalAccountHPT25\Desktop\newsaas\agency-26-hackathon\general\visualizations\server.js",
  [string]$BackendServerJsVmPath = "/var/www/AccountabilityMax-/general/visualizations/server.js",
  [string]$ApiServiceName = "accountibilitymax-api",
  [switch]$SyncBackend = $true,
  [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"

function Require-Path([string]$path, [string]$label) {
  if (!(Test-Path $path)) {
    throw "$label not found: $path"
  }
}

function Invoke-Ssh([string]$command) {
  & ssh -i $SshKeyPath "$VmUser@$VmHost" $command
  if ($LASTEXITCODE -ne 0) {
    throw "SSH command failed: $command"
  }
}

function Invoke-Scp([string]$source, [string]$destination) {
  & scp -i $SshKeyPath -r $source $destination
  if ($LASTEXITCODE -ne 0) {
    throw "SCP failed: $source -> $destination"
  }
}

Write-Host "== Contest deploy to Prod3 =="
Require-Path $SshKeyPath "SSH key"
Require-Path $FrontendRepoPath "Frontend repo"

if (!$SkipBuild) {
  Write-Host "Building frontend..."
  Push-Location $FrontendRepoPath
  try {
    npm run build
    if ($LASTEXITCODE -ne 0) {
      throw "Frontend build failed."
    }
  }
  finally {
    Pop-Location
  }
}
else {
  Write-Host "Skipping frontend build."
}

$distPath = Join-Path $FrontendRepoPath "dist"
Require-Path $distPath "Frontend dist"

Write-Host "Uploading frontend dist to VM temp path..."
Invoke-Ssh "mkdir -p $FrontendVmTempPath"
Invoke-Scp "$distPath/*" "$VmUser@$VmHost`:$FrontendVmTempPath/"

Write-Host "Publishing frontend dist..."
Invoke-Ssh "sudo mkdir -p $FrontendVmDistPath && sudo rm -rf $FrontendVmDistPath/* && sudo cp -r $FrontendVmTempPath/* $FrontendVmDistPath/ && sudo chown -R www-data:www-data /var/www/Contest && rm -rf $FrontendVmTempPath/*"

if ($SyncBackend) {
  Write-Host "Syncing backend server.js..."
  Require-Path $BackendServerJsLocalPath "Local backend server.js"
  Invoke-Scp $BackendServerJsLocalPath "$VmUser@$VmHost`:/tmp/server.js"
  Invoke-Ssh "sudo cp /tmp/server.js $BackendServerJsVmPath && sudo chown azureuser:azureuser $BackendServerJsVmPath && sudo systemctl restart $ApiServiceName"
}
else {
  Write-Host "Skipping backend sync/restart."
}

Write-Host "Running post-deploy checks..."
Invoke-Ssh "curl -sS --max-time 20 http://127.0.0.1:3801/ > /dev/null"
Invoke-Ssh "curl -sS --max-time 90 'http://127.0.0.1:3801/api/governance/pairs?limit=1' > /dev/null"

Write-Host ""
Write-Host "Deploy complete."
Write-Host "Check public site:"
Write-Host "  https://lev3l.website"
