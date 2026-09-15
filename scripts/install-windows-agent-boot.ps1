param(
  [Parameter(Mandatory = $true)][string] $Root,
  [Parameter(Mandatory = $true)][string] $NodePath
)

$ErrorActionPreference = 'Stop'
$rootFull = [IO.Path]::GetFullPath($Root)
$scriptPath = Join-Path $rootFull 'reconcile.ps1'
$logPath = Join-Path $rootFull 'logs\boot-install.log'
$userTask = 'NexusBetCollectorAgent'
$bootTask = 'NexusBetCollectorAgentBoot'

try {
  if (-not (Test-Path -LiteralPath $scriptPath)) { throw 'Missing private supervisor script' }
  if (-not (Test-Path -LiteralPath $NodePath)) { throw 'Missing Node executable' }
  $taskArgument = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $scriptPath + '" -Root "' + $rootFull + '" -NodePath "' + $NodePath + '"'
  $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $taskArgument
  $startup = New-ScheduledTaskTrigger -AtStartup
  $poll = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 1)
  $settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Hours 3) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
  $principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
  Disable-ScheduledTask -TaskName $userTask | Out-Null
  Register-ScheduledTask -TaskName $bootTask -Action $action -Trigger $startup,$poll -Settings $settings -Principal $principal -Force | Out-Null
  Start-ScheduledTask -TaskName $bootTask
  Set-Content -LiteralPath $logPath -Value "$(Get-Date -Format o) Registered boot task as SYSTEM and disabled user logon task" -Encoding utf8
} catch {
  Enable-ScheduledTask -TaskName $userTask -ErrorAction SilentlyContinue | Out-Null
  Set-Content -LiteralPath $logPath -Value "$(Get-Date -Format o) ERROR: $($_.Exception.Message)" -Encoding utf8
  exit 1
}
