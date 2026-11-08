<#
.SYNOPSIS
  Builds the resized WebP images the site serves through <picture>/srcset.

.DESCRIPTION
  Originals in /assets are never modified: browsers without WebP support, the
  gallery lightbox and the no-JavaScript links all use them.

  Variants are written to /assets/resized as <name>-<width>w.webp:
    - only widths smaller than the original are produced (no upscaling); when
      the largest planned width is at least the original's, a same-size WebP
      is added as the top candidate;
    - a variant that isn't at least 15% lighter than its original is dropped,
      and the page should list the original instead;
    - metadata (EXIF, GPS, camera data) is stripped; an embedded colour profile
      is kept so wide-gamut phone photos keep their colours.
  Files in /assets/resized that this run didn't produce are removed.

  Gallery images are discovered from the <a href="./assets/gallery-…"> links in
  index.html, so files that aren't on the page are skipped. Variants newer than
  their source are left alone; pass -Force to rebuild everything.

  Requires cwebp (Google libwebp). It is looked up via -Cwebp, then PATH, then
  %LOCALAPPDATA%\Programs\libwebp-*\bin. Official builds:
  https://storage.googleapis.com/downloads.webmproject.org/releases/webp/index.html

  After adding or replacing an image, run this script, then add/update the
  matching <picture> in index.html (see the existing gallery items).

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts/optimize-images.ps1
#>
[CmdletBinding()]
param(
  [string]$SiteRoot, # defaults to the folder above this script
  [string]$Cwebp,
  [switch]$Force
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

# ($PSScriptRoot isn't available in param defaults on Windows PowerShell 5.1)
if (-not $SiteRoot) { $SiteRoot = Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) '..' }
$SiteRoot = (Resolve-Path $SiteRoot).Path
$assets = Join-Path $SiteRoot 'assets'
$outDir = Join-Path $assets 'resized'
New-Item -ItemType Directory -Force $outDir | Out-Null

if (-not $Cwebp) {
  $onPath = Get-Command cwebp -ErrorAction SilentlyContinue
  if ($onPath) {
    $Cwebp = $onPath.Source
  } else {
    $Cwebp = Get-ChildItem (Join-Path $env:LOCALAPPDATA 'Programs') -Filter 'libwebp-*' -Directory -ErrorAction SilentlyContinue |
      Sort-Object Name -Descending |
      ForEach-Object { Join-Path $_.FullName 'bin\cwebp.exe' } |
      Where-Object { Test-Path $_ } |
      Select-Object -First 1
  }
}
if (-not $Cwebp -or -not (Test-Path $Cwebp)) {
  throw 'cwebp not found. Install libwebp (see the help above) or pass -Cwebp <path to cwebp.exe>.'
}

# Target widths come from how large each image is drawn on the page (CSS px x 2 for retina).
$plan = @(
  @{ Files = @('hero.jpg');                       Widths = @(960, 1600, 2160); Quality = 86 } # LCP art: crisp ink strokes
  @{ Files = @('profile.jpg');                    Widths = @(800, 1400);       Quality = 82 }
  @{ Files = @('birds.jpg', 'lief.jpg', 'sun.jpg'); Widths = @(800, 1400);     Quality = 76 }
)

$html = Get-Content -Raw -Encoding UTF8 (Join-Path $SiteRoot 'index.html')
$gallery = [regex]::Matches($html, 'href="\./assets/(gallery-\d+\.(?:jpg|jpeg|png))"') |
  ForEach-Object { $_.Groups[1].Value } | Select-Object -Unique
$plan += @{ Files = @($gallery); Widths = @(480, 960); Quality = 74 }

# A variant must be meaningfully lighter than its original, otherwise the page
# should just use the original (more pixels for the same bytes).
$MAX_SIZE_RATIO = 0.85

$produced = New-Object System.Collections.Generic.HashSet[string]
$results = foreach ($group in $plan) {
  foreach ($file in $group.Files) {
    $sourcePath = Join-Path $assets $file
    if (-not (Test-Path -LiteralPath $sourcePath)) {
      Write-Warning "Missing source: $file"
      continue
    }
    $sourceInfo = Get-Item -LiteralPath $sourcePath
    $base = [IO.Path]::GetFileNameWithoutExtension($file)
    $image = [System.Drawing.Image]::FromFile($sourcePath)
    $sourceWidth = $image.Width
    $image.Dispose()

    $widths = @($group.Widths | Where-Object { $_ -lt $sourceWidth })
    if (($group.Widths | Measure-Object -Maximum).Maximum -ge $sourceWidth) { $widths += $sourceWidth }

    foreach ($width in ($widths | Sort-Object -Unique)) {
      $name = '{0}-{1}w.webp' -f $base, $width
      $destination = Join-Path $outDir $name
      $fresh = (Test-Path -LiteralPath $destination) -and
        ((Get-Item -LiteralPath $destination).LastWriteTime -ge $sourceInfo.LastWriteTime)
      if ($fresh -and -not $Force) {
        $status = 'kept'
      } else {
        $resize = if ($width -lt $sourceWidth) { @('-resize', $width, 0) } else { @() }
        & $Cwebp -quiet -mt -m 6 -sharp_yuv -q $group.Quality -metadata icc @resize $sourcePath -o $destination
        if ($LASTEXITCODE -ne 0) { throw "cwebp failed for $file at ${width}w" }
        $status = 'built'
      }
      $bytes = (Get-Item -LiteralPath $destination).Length
      if ($bytes -ge $MAX_SIZE_RATIO * $sourceInfo.Length) {
        Remove-Item -LiteralPath $destination
        $status = 'dropped (use original)'
      } else {
        [void]$produced.Add($name)
      }
      [pscustomobject]@{
        Variant  = $name
        Status   = $status
        SourceKB = [math]::Round($sourceInfo.Length / 1KB)
        KB       = if ($status -like 'dropped*') { $null } else { [math]::Round($bytes / 1KB) }
      }
    }
  }
}

# Remove variants this run no longer produces (renamed sources, older formats).
$stale = Get-ChildItem -LiteralPath $outDir -File |
  Where-Object { $_.Name -match '-\d+w\.(webp|jpg)$' -and -not $produced.Contains($_.Name) }
foreach ($file in $stale) { Remove-Item -LiteralPath $file.FullName }

$results | Format-Table -AutoSize
$kept = @($results | Where-Object { $_.Status -notlike 'dropped*' })
'{0} variants, {1:N0} KB total; removed {2} stale file(s). cwebp: {3}' -f $kept.Count, (($kept | Measure-Object KB -Sum).Sum), @($stale).Count, $Cwebp
