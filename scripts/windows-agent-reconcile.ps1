param(
  [string] $Root = (Join-Path $env:LOCALAPPDATA 'NexusBet'),
  [string] $NodePath = ''
)

$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath($Root)
$configPath = Join-Path $root 'agent.json'
$releases = Join-Path $root 'releases'
$currentPath = Join-Path $root 'current.txt'
$failedPath = Join-Path $root 'failed.txt'
$pidPath = Join-Path $root 'agent.pid'
$stopPath = Join-Path $root 'agent.stop'
$logPath = Join-Path $root 'logs\supervisor.log'
$mutex = New-Object System.Threading.Mutex($false, 'Local\NexusBetAgentReconcile')
if (-not $mutex.WaitOne(0)) { exit 0 }

function Log([string] $message) {
  Add-Content -LiteralPath $logPath -Value "$(Get-Date -Format o) $message"
}

function CheckExit([string] $label) {
  if ($LASTEXITCODE -ne 0) { throw "$label failed (exit $LASTEXITCODE)" }
}

function AgentProcess {
  if (-not (Test-Path -LiteralPath $pidPath)) { return $null }
  $agentPid = [int](Get-Content -LiteralPath $pidPath -Raw)
  $process = Get-Process -Id $agentPid -ErrorAction SilentlyContinue
  if (-not $process -or $process.ProcessName -ne 'node') { return $null }
  $command = (Get-CimInstance Win32_Process -Filter "ProcessId=$agentPid").CommandLine
  if ($command -notmatch 'collector-agent\.main\.js') { return $null }
  return $process
}

try {
  New-Item -ItemType Directory -Force -Path $root,$releases,(Join-Path $root 'logs') | Out-Null
  if (-not (Test-Path -LiteralPath $configPath)) { throw 'Missing private agent.json' }
  $node = $NodePath
  if (-not $node) {
    $node = Get-ChildItem -Path (Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Packages') -Filter node.exe -Recurse |
      Where-Object FullName -Match 'OpenJS.NodeJS.LTS' | Select-Object -First 1 -ExpandProperty FullName
  }
  if (-not $node) { throw 'Node LTS not installed' }
  $nodeDir = Split-Path $node
  $npm = Join-Path $nodeDir 'npm.cmd'
  $env:PATH = "$nodeDir;C:\Program Files\Git\cmd;$env:PATH"
  $env:npm_config_script_shell = 'C:\Program Files\Git\bin\bash.exe'
  $current = if (Test-Path -LiteralPath $currentPath) { (Get-Content -LiteralPath $currentPath -Raw).Trim() } else { '' }
  $previous = $current
  $target = ''
  try {
    $remote = & git ls-remote https://github.com/andre-fig/nexusbet.git refs/heads/main 2>$null
    CheckExit 'Git remote check'
    $target = ($remote -split '\s+')[0]
    if ($target -notmatch '^[a-f0-9]{40}$') { throw 'Invalid main SHA' }
  } catch {
    Log "GitHub unavailable: $($_.Exception.Message); keeping current release"
  }
  $failed = if (Test-Path -LiteralPath $failedPath) { (Get-Content -LiteralPath $failedPath -Raw).Trim() } else { '' }
  if ($target -eq $failed) { $target = '' }

  if ($target -and $target -ne $current) {
    $release = Join-Path $releases $target
    $verifiedPath = Join-Path $release '.agent-verified'
    $prepared = $false
    try {
      $verified = (Test-Path -LiteralPath $verifiedPath) -and ((Get-Content -LiteralPath $verifiedPath -Raw).Trim() -eq $target)
      if (-not $verified) {
        $releaseFull = [IO.Path]::GetFullPath($release)
        $releasesFull = [IO.Path]::GetFullPath($releases).TrimEnd('\') + '\'
        if (-not $releaseFull.StartsWith($releasesFull, [StringComparison]::OrdinalIgnoreCase)) { throw 'Release path escapes releases directory' }
        if (Test-Path -LiteralPath $release) { Remove-Item -LiteralPath $release -Recurse -Force }
        Log "Preparing release $target"
        & git clone --quiet --depth 1 --branch main https://github.com/andre-fig/nexusbet.git $release
        CheckExit 'Git clone'
        $cloned = (& git -C $release rev-parse HEAD).Trim()
        CheckExit 'Git SHA check'
        if ($cloned -ne $target) { throw 'Main moved during clone; retry on next check' }
        Push-Location (Join-Path $release 'apps\odds-service')
        try {
          & $npm ci; CheckExit 'npm ci'
          & $npm run typecheck; CheckExit 'typecheck'
          & $npm run format:check; CheckExit 'format check'
          & $npm run build; CheckExit 'build'
          & $npm test; CheckExit 'tests'
        } finally { Pop-Location }
        Set-Content -LiteralPath $verifiedPath -Value $target -Encoding ascii
        Log "Release $target passed checks"
      }
      $prepared = $true
    } catch {
      Log "Release $target failed checks: $($_.Exception.Message); keeping current release"
      Set-Content -LiteralPath $failedPath -Value $target -Encoding ascii
    }

    if ($prepared) {
      $old = AgentProcess
      if ($old) {
        New-Item -ItemType File -Force -Path $stopPath | Out-Null
        Log "Requesting graceful stop of PID $($old.Id)"
        if (-not $old.WaitForExit(180000)) {
          Log "Grace period expired; terminating PID $($old.Id)"
          Stop-Process -Id $old.Id -Force
        }
      }
      Set-Content -LiteralPath $currentPath -Value $target -Encoding ascii
      $current = $target
    }
  }

  $running = AgentProcess
  if (-not $running -and $current) {
    $release = Join-Path $releases $current
    $service = Join-Path $release 'apps\odds-service'
    if (-not (Test-Path -LiteralPath (Join-Path $service 'dist\collector-agent.main.js'))) { throw 'Current release missing build' }
    $config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
    foreach ($property in $config.PSObject.Properties) {
      [Environment]::SetEnvironmentVariable($property.Name, [string]$property.Value, 'Process')
    }
    [Environment]::SetEnvironmentVariable('ODDS_AGENT_STOP_FILE', $stopPath, 'Process')
    Remove-Item -LiteralPath $stopPath -Force -ErrorAction SilentlyContinue
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $stdout = Join-Path $root "logs\agent-$stamp.out.log"
    $stderr = Join-Path $root "logs\agent-$stamp.err.log"
    $agent = Start-Process -FilePath $node -ArgumentList 'dist/collector-agent.main.js' -WorkingDirectory $service -WindowStyle Hidden -PassThru -RedirectStandardOutput $stdout -RedirectStandardError $stderr
    Set-Content -LiteralPath $pidPath -Value $agent.Id -Encoding ascii
    Log "Started $current as PID $($agent.Id)"
    Start-Sleep -Seconds 10
    if ($agent.HasExited -and $previous -and $previous -ne $current) {
      Log "Release $current exited during startup; restoring $previous"
      Set-Content -LiteralPath $failedPath -Value $current -Encoding ascii
      Set-Content -LiteralPath $currentPath -Value $previous -Encoding ascii
      $previousService = Join-Path (Join-Path $releases $previous) 'apps\odds-service'
      $fallback = Start-Process -FilePath $node -ArgumentList 'dist/collector-agent.main.js' -WorkingDirectory $previousService -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $root "logs\agent-$stamp-rollback.out.log") -RedirectStandardError (Join-Path $root "logs\agent-$stamp-rollback.err.log")
      Set-Content -LiteralPath $pidPath -Value $fallback.Id -Encoding ascii
      Log "Restored $previous as PID $($fallback.Id)"
    }
  }
} catch {
  Log "ERROR: $($_.Exception.Message)"
  exit 1
} finally {
  $mutex.ReleaseMutex()
  $mutex.Dispose()
}
