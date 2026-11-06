# gitnut installer for Windows.
#   irm __GITNUT_SITE_URL__/install.ps1 | iex
# Env: GITNUT_VERSION (default __GITNUT_VERSION__).
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$Version = if ($env:GITNUT_VERSION) { $env:GITNUT_VERSION } else { '__GITNUT_VERSION__' }
$Base = '__GITNUT_DOWNLOAD_BASE__'
$File = 'gitnut-windows-x64.exe'
# Same folder the desktop app uses, so CLI and app share one daemon binary.
$GitnutHome = if ($env:GITNUT_HOME) { $env:GITNUT_HOME } else { Join-Path $HOME '.gitnut' }
$BinDir = Join-Path $GitnutHome 'bin'
$Tmp = Join-Path ([System.IO.Path]::GetTempPath()) ("gitnut-" + [guid]::NewGuid())
New-Item -ItemType Directory -Force -Path $Tmp | Out-Null

try {
  Write-Host "Downloading gitnut $Version (windows-x64)..."
  Invoke-WebRequest -UseBasicParsing -Uri "$Base/$Version/$File" -OutFile (Join-Path $Tmp $File)
  Invoke-WebRequest -UseBasicParsing -Uri "$Base/$Version/SHA256SUMS" -OutFile (Join-Path $Tmp 'SHA256SUMS')

  $Expected = $null
  foreach ($Line in Get-Content (Join-Path $Tmp 'SHA256SUMS')) {
    $Parts = $Line.Trim() -split '\s+', 2
    if ($Parts.Count -eq 2 -and $Parts[1].TrimStart('*') -eq $File) { $Expected = $Parts[0].ToLower() }
  }
  if (-not $Expected) { throw "$File is not listed in SHA256SUMS" }
  $Actual = (Get-FileHash -Algorithm SHA256 (Join-Path $Tmp $File)).Hash.ToLower()
  if ($Expected -ne $Actual) { throw "checksum mismatch for $File (expected $Expected, got $Actual)" }

  New-Item -ItemType Directory -Force -Path $BinDir | Out-Null
  $Target = Join-Path $BinDir 'gitnut.exe'
  # A running daemon locks gitnut.exe; Windows allows renaming it out of the way.
  if (Test-Path $Target) { Move-Item -Force $Target "$Target.old" }
  Move-Item -Force (Join-Path $Tmp $File) $Target
  Remove-Item -Force "$Target.old" -ErrorAction SilentlyContinue
  Write-Host "Installed $Target"

  $UserPath = [Environment]::GetEnvironmentVariable('Path', 'User')
  if (-not (($UserPath -split ';') -contains $BinDir)) {
    [Environment]::SetEnvironmentVariable('Path', ($(if ($UserPath) { "$UserPath;" } else { '' }) + $BinDir), 'User')
    $env:Path = "$env:Path;$BinDir"
    Write-Host "Added $BinDir to your user PATH (open a new terminal to use it)."
  }

  Write-Host ''
  Write-Host 'Next steps:'
  Write-Host '  gitnut status                  # shows the URL to open (127.0.0.1, no login needed)'
  Write-Host '  Add projects in the client, or: gitnut repos add <repo> / gitnut roots add <folder>'
  Write-Host '  Other machines: gitnut config set auth.enabled true; gitnut config set bind tailscale; gitnut token'
} finally {
  Remove-Item -Recurse -Force $Tmp -ErrorAction SilentlyContinue
}
