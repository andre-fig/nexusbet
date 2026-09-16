param(
  [string] $Root = (Join-Path $env:LOCALAPPDATA 'NexusBet'),
  [string] $NodePath = ''
)

$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath($Root)
$releases = Join-Path $root 'extension-releases'
$currentPath = Join-Path $root 'extension-current.txt'
$extensionPath = Join-Path $root 'collector-extension'
$logPath = Join-Path $root 'logs\extension-updater.log'
$mutex = New-Object System.Threading.Mutex($false, 'Global\NexusBetExtensionReconcile')
$claimed = $false
try { $claimed = $mutex.WaitOne(0) }
catch [Threading.AbandonedMutexException] { $claimed = $true }
if (-not $claimed) { $mutex.Dispose(); exit 0 }

function Log([string] $message) {
  Add-Content -LiteralPath $logPath -Value "$(Get-Date -Format o) $message"
}

function CheckExit([string] $label) {
  if ($LASTEXITCODE -ne 0) { throw "$label failed (exit $LASTEXITCODE)" }
}

function Inside([string] $path, [string] $parent) {
  $full = [IO.Path]::GetFullPath($path)
  $prefix = [IO.Path]::GetFullPath($parent).TrimEnd('\') + '\'
  if (-not $full.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Target escapes expected directory"
  }
}

function StageExtension([string] $dist, [string] $sha) {
  Inside $extensionPath $root
  $names = @('manifest.json','background.js','popup.html','popup.js')
  $buildId = (Get-Content -LiteralPath (Join-Path $dist 'build-id.txt') -Raw).Trim()
  if ($buildId -notmatch '^[a-f0-9]{20}$') { throw 'Invalid extension build ID' }
  New-Item -ItemType Directory -Force -Path $extensionPath | Out-Null
  $destinationBuildId = Join-Path $extensionPath 'build-id.txt'
  if ((Test-Path -LiteralPath $destinationBuildId) -and
      (Get-Content -LiteralPath $destinationBuildId -Raw).Trim() -eq $buildId -and
      $names.Where({ Test-Path -LiteralPath (Join-Path $extensionPath $_) }).Count -eq $names.Count) {
    Log "Bundle unchanged at $sha"
    return
  }
  foreach ($name in $names) {
    Copy-Item -LiteralPath (Join-Path $dist $name) -Destination (Join-Path $extensionPath $name) -Force
  }
  Copy-Item -LiteralPath (Join-Path $dist 'build-id.txt') -Destination $destinationBuildId -Force
  Log "Bundle staged at $sha ($buildId)"
}

try {
  New-Item -ItemType Directory -Force -Path $root,$releases,(Join-Path $root 'logs') | Out-Null
  $current = if (Test-Path -LiteralPath $currentPath) {
    (Get-Content -LiteralPath $currentPath -Raw).Trim()
  } else { '' }
  try {
    $remote = & git ls-remote https://github.com/andre-fig/nexusbet.git refs/heads/main 2>$null
    CheckExit 'GitHub check'
    $target = ($remote -split '\s+')[0]
    if ($target -notmatch '^[a-f0-9]{40}$') { throw 'Invalid main SHA' }
  } catch {
    Log "GitHub unavailable: $($_.Exception.Message); retaining $current"
    exit 0
  }
  if ($target -eq $current) { exit 0 }

  $release = Join-Path $releases $target
  Inside $release $releases
  $verifiedPath = Join-Path $release '.extension-verified'
  $verified = (Test-Path -LiteralPath $verifiedPath) -and
    ((Get-Content -LiteralPath $verifiedPath -Raw).Trim() -eq $target)
  if (-not $verified) {
    if (Test-Path -LiteralPath $release) { Remove-Item -LiteralPath $release -Recurse -Force }
    Log "Preparing $target"
    & git -c core.autocrlf=false clone --quiet --depth 1 --branch main https://github.com/andre-fig/nexusbet.git $release
    CheckExit 'Git clone'
    $cloned = (& git -C $release rev-parse HEAD).Trim()
    CheckExit 'Git SHA check'
    if ($cloned -ne $target) {
      Log "Main moved during clone; retrying next check"
      exit 0
    }
    $node = $NodePath
    if (-not $node) {
      $node = Get-ChildItem -Path (Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Packages') -Filter node.exe -Recurse |
        Where-Object FullName -Match 'OpenJS.NodeJS.LTS' | Select-Object -First 1 -ExpandProperty FullName
    }
    if (-not $node) { throw 'Node LTS not installed' }
    $nodeDir = Split-Path $node
    $npm = Join-Path $nodeDir 'npm.cmd'
    $env:PATH = "$nodeDir;C:\Program Files\Git\cmd;$env:PATH"
    Push-Location (Join-Path $release 'apps\odds-collector-extension')
    try {
      & $npm ci; CheckExit 'extension npm ci'
      & $npm run typecheck; CheckExit 'extension typecheck'
      & $npm run format:check; CheckExit 'extension format check'
      & $npm test; CheckExit 'extension tests'
      & $npm run build; CheckExit 'extension build'
    } finally { Pop-Location }
    Set-Content -LiteralPath $verifiedPath -Value $target -Encoding ascii
    Log "Release $target passed checks"
  }
  StageExtension (Join-Path $release 'apps\odds-collector-extension\dist') $target
  Set-Content -LiteralPath $currentPath -Value $target -Encoding ascii
} catch {
  Log "ERROR: $($_.Exception.Message)"
  exit 1
} finally {
  $mutex.ReleaseMutex()
  $mutex.Dispose()
}
