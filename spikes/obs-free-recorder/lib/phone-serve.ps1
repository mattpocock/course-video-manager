# Serves the phone's marker video (lib/phone.ts) to the phone over the LAN.
# Runs on Windows: WSL is in NAT mode on this machine, so a phone can't reach a
# server inside WSL. A plain TcpListener needs no admin rights (HttpListener
# would need a URL reservation). The first time, Windows Firewall may ask
# whether PowerShell may accept connections on private networks: Allow.
#
#   -File <path> -Port <n> -StopFile <path> [-MaxMinutes 60] [-Bind 0.0.0.0]
#
# GET /          a page with one big download link
# GET /<name>    the MP4, as a download (Content-Disposition: attachment)
# Prints "URL http://<LAN IPv4>:<port>/" once it listens, then one line per
# request. Stops when <StopFile> appears or MaxMinutes pass.
param([string]$File, [int]$Port = 4793, [string]$StopFile, [int]$MaxMinutes = 60, [string]$Bind = '0.0.0.0')

$ErrorActionPreference = 'Stop'
$name = [IO.Path]::GetFileName($File)
$size = (Get-Item -LiteralPath $File).Length

# The LAN address: the up adapter that has a default gateway (not WSL's vEthernet).
$ip = $null
if ($Bind -ne '0.0.0.0') { $ip = $Bind } else {
  $cfg = Get-NetIPConfiguration | Where-Object { $_.IPv4DefaultGateway -and $_.NetAdapter.Status -eq 'Up' } | Select-Object -First 1
  if ($cfg) { $ip = @($cfg.IPv4Address)[0].IPAddress }
  if (-not $ip) { $ip = 'localhost' }
}

$listener = New-Object System.Net.Sockets.TcpListener ([Net.IPAddress]::Parse($Bind)), $Port
try { $listener.Start() } catch { Write-Output "ERROR port $Port is busy: $($_.Exception.Message)"; exit 2 }
Write-Output "URL http://${ip}:${Port}/"
[Console]::Out.Flush()

$page = @"
<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>OBS rig phone video</title>
<style>body{font:20px system-ui;margin:24px;background:#111;color:#eee}a{display:block;margin:24px 0;padding:24px;background:#2a6;color:#fff;text-align:center;border-radius:12px;text-decoration:none;font-size:26px}</style></head>
<body><h2>OBS rig: phone video</h2>
<a href="/$name" download>Download the video ($([Math]::Round($size / 1MB)) MB)</a>
<ol><li>When it's downloaded, open <b>Files by Google</b> &rarr; Downloads &rarr; <b>$name</b>, and tap play.</li>
<li>Brightness full, Adaptive brightness off, volume about 2/3, plugged in.</li>
<li>Prop it close in front of the camera, in the middle of the picture, its screen filling at least a quarter of it.</li></ol>
<p>It plays 2.5 hours: black, with a white flash and a beep every 10 s.</p></body></html>
"@
$pageBytes = [Text.Encoding]::UTF8.GetBytes($page)

function Send-Head($stream, [string]$status, [string]$type, [long]$length, [string]$extra = '') {
  $h = "HTTP/1.1 $status`r`nContent-Type: $type`r`nContent-Length: $length`r`nCache-Control: no-store`r`nConnection: close`r`n$extra`r`n"
  $b = [Text.Encoding]::ASCII.GetBytes($h)
  $stream.Write($b, 0, $b.Length)
}

$deadline = (Get-Date).AddMinutes($MaxMinutes)
try {
  while ((Get-Date) -lt $deadline -and -not ($StopFile -and (Test-Path -LiteralPath $StopFile))) {
    if (-not $listener.Pending()) { Start-Sleep -Milliseconds 200; continue }
    $client = $listener.AcceptTcpClient()
    try {
      $client.ReceiveTimeout = 5000
      $stream = $client.GetStream()
      $reader = New-Object IO.StreamReader($stream, [Text.Encoding]::ASCII, $false, 4096, $true)
      $first = $reader.ReadLine()
      while ($true) { $l = $reader.ReadLine(); if ($null -eq $l -or $l -eq '') { break } }
      $parts = "$first".Split(' ')
      $method = $parts[0]; $path = if ($parts.Count -gt 1) { $parts[1] } else { '/' }
      Write-Output "$(Get-Date -Format HH:mm:ss) $($client.Client.RemoteEndPoint) $first"
      [Console]::Out.Flush()
      if ($path -eq '/' -or $path -eq '/index.html') {
        Send-Head $stream '200 OK' 'text/html; charset=utf-8' $pageBytes.Length
        if ($method -ne 'HEAD') { $stream.Write($pageBytes, 0, $pageBytes.Length) }
      } elseif ($path -eq "/$name") {
        Send-Head $stream '200 OK' 'video/mp4' $size "Content-Disposition: attachment; filename=`"$name`"`r`n"
        if ($method -ne 'HEAD') {
          $fs = [IO.File]::OpenRead($File)
          try { $fs.CopyTo($stream, 1MB) } finally { $fs.Dispose() }
          Write-Output "$(Get-Date -Format HH:mm:ss) sent $name ($size bytes)"
        }
      } else {
        $nf = [Text.Encoding]::ASCII.GetBytes('not found')
        Send-Head $stream '404 Not Found' 'text/plain' $nf.Length
        $stream.Write($nf, 0, $nf.Length)
      }
      $stream.Flush()
    } catch {
      Write-Output "$(Get-Date -Format HH:mm:ss) request failed: $($_.Exception.Message)"
    } finally { $client.Close() }
  }
} finally { $listener.Stop() }
