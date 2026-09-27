<#
  KAGE · Put sjene — pokretač za Windows PowerShell

  Upotreba:
    .\Pokreni-KAGE.ps1            # otvara igru u Edge/Chrome prozoru bez trake (app mode)
    .\Pokreni-KAGE.ps1 -Server    # poslužuje igru na http://localhost:8642 (ako preglednik blokira file://)
    .\Pokreni-KAGE.ps1 -Browser   # otvara u zadanom pregledniku, u običnoj kartici
#>
param(
  [switch]$Server,
  [switch]$Browser,
  [int]$Port = 8642
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$index = Join-Path $root 'index.html'
if (-not (Test-Path $index)) { Write-Error "Nema index.html pored skripte ($root)." }

function Find-AppBrowser {
  $candidates = @(
    "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
    "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
    "$env:LocalAppData\Google\Chrome\Application\chrome.exe"
  )
  foreach ($c in $candidates) { if ($c -and (Test-Path $c)) { return $c } }
  return $null
}

function Open-Game([string]$url) {
  $app = Find-AppBrowser
  if ($app -and -not $Browser) {
    Write-Host "  Otvaram u prozoru igre: $url" -ForegroundColor DarkGray
    Start-Process -FilePath $app -ArgumentList "--app=$url", '--window-size=1400,860', '--autoplay-policy=no-user-gesture-required'
  } else {
    Start-Process $url
  }
}

Write-Host ''
Write-Host '   影  KAGE · Put sjene' -ForegroundColor Red
Write-Host '   J napad · K jaki · L blok · Razmak skok · C kolut · Q shuriken · F dim · Esc pauza' -ForegroundColor Gray
Write-Host ''

if (-not $Server) {
  $url = ([System.Uri]$index).AbsoluteUri
  Open-Game $url
  return
}

# Minimalni lokalni HTTP poslužitelj (samo localhost, samo datoteke iz mape igre)
$mime = @{ '.html' = 'text/html; charset=utf-8'; '.js' = 'text/javascript; charset=utf-8'; '.css' = 'text/css'; '.png' = 'image/png'; '.json' = 'application/json' }
$listener = New-Object System.Net.HttpListener
$prefix = "http://localhost:$Port/"
$listener.Prefixes.Add($prefix)
$listener.Start()
Write-Host "  Poslužujem na $prefix  (Ctrl+C za kraj)" -ForegroundColor Yellow
Open-Game $prefix
try {
  while ($listener.IsListening) {
    $ctx = $listener.GetContext()
    $rel = [System.Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath.TrimStart('/'))
    if ([string]::IsNullOrEmpty($rel)) { $rel = 'index.html' }
    $path = [System.IO.Path]::GetFullPath((Join-Path $root $rel))
    $res = $ctx.Response
    if ($path.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase) -and (Test-Path $path -PathType Leaf)) {
      $bytes = [System.IO.File]::ReadAllBytes($path)
      $ext = [System.IO.Path]::GetExtension($path).ToLower()
      $res.ContentType = if ($mime.ContainsKey($ext)) { $mime[$ext] } else { 'application/octet-stream' }
      $res.ContentLength64 = $bytes.Length
      $res.OutputStream.Write($bytes, 0, $bytes.Length)
    } else {
      $res.StatusCode = 404
    }
    $res.Close()
  }
} finally {
  $listener.Stop()
}
