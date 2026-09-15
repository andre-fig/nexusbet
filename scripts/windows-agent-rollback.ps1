param(
  [Parameter(Mandatory = $true)][string] $Root,
  [Parameter(Mandatory = $true)][string] $ValidatedSha,
  [Parameter(Mandatory = $true)][string] $RejectedSha
)

$ErrorActionPreference = 'Stop'
$rootFull = [IO.Path]::GetFullPath($Root)
$logPath = Join-Path $rootFull 'logs\rollback.log'
try {
  if ($ValidatedSha -notmatch '^[a-f0-9]{40}$' -or $RejectedSha -notmatch '^[a-f0-9]{40}$') { throw 'Invalid SHA' }
  $validatedRelease = Join-Path (Join-Path $rootFull 'releases') $ValidatedSha
  if (-not (Test-Path -LiteralPath (Join-Path $validatedRelease 'apps\odds-service\dist\collector-agent.main.js'))) { throw 'Validated release missing build' }
  Stop-ScheduledTask -TaskName NexusBetCollectorAgentBoot -ErrorAction SilentlyContinue
  $agentProcessId = [int](Get-Content -LiteralPath (Join-Path $rootFull 'agent.pid') -Raw)
  $process = Get-CimInstance Win32_Process -Filter "ProcessId=$agentProcessId"
  if ($process -and $process.Name -eq 'node.exe') {
    if ($process.CommandLine -notmatch 'collector-agent\.main\.js') { throw 'Agent PID points to another Node process' }
    Stop-Process -Id $agentProcessId -Force
  }
  Set-Content -LiteralPath (Join-Path $rootFull 'failed.txt') -Value $RejectedSha -Encoding ascii
  Set-Content -LiteralPath (Join-Path $rootFull 'current.txt') -Value $ValidatedSha -Encoding ascii
  Set-Content -LiteralPath (Join-Path $validatedRelease '.agent-verified') -Value $ValidatedSha -Encoding ascii
  Start-ScheduledTask -TaskName NexusBetCollectorAgentBoot
  Set-Content -LiteralPath $logPath -Value "$(Get-Date -Format o) Restored validated $ValidatedSha; rejected $RejectedSha" -Encoding utf8
} catch {
  Set-Content -LiteralPath $logPath -Value "$(Get-Date -Format o) ERROR: $($_.Exception.Message)" -Encoding utf8
  exit 1
}
