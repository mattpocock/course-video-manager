# Minimal obs-websocket v5 client, run on Windows. WSL is in NAT mode on this
# machine, so ws://localhost:4455 only reaches OBS from the Windows side (the
# same reason CVM's browser, not its server, talks to OBS).
#
#   -Url       ws://host:port (lib/obs.ts resolves it the way CVM does)
#   -Requests  base64 of a JSON array: [{ "requestType": "...", "requestData": {...} }, ...]
#
# Prints one JSON line per request: { requestType, ok, code, comment, data }.
# Exits 2 when OBS can't be reached or identification fails. No password:
# CVM connects without one, so an OBS that asks for one is reported, not guessed.
param([string]$Url, [string]$Requests, [int]$TimeoutSec = 10)

$ErrorActionPreference = 'Stop'
$reqs = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($Requests)) | ConvertFrom-Json
$ws = New-Object System.Net.WebSockets.ClientWebSocket
$cts = New-Object System.Threading.CancellationTokenSource
$cts.CancelAfter([TimeSpan]::FromSeconds($TimeoutSec + 5 * @($reqs).Count))

function Send([string]$text) {
  $bytes = [Text.Encoding]::UTF8.GetBytes($text)
  $seg = New-Object System.ArraySegment[byte] -ArgumentList @(, $bytes)
  $ws.SendAsync($seg, [System.Net.WebSockets.WebSocketMessageType]::Text, $true, $cts.Token).Wait()
}
function Receive() {
  $buf = New-Object byte[] 65536
  $ms = New-Object System.IO.MemoryStream
  do {
    $seg = New-Object System.ArraySegment[byte] -ArgumentList @(, $buf)
    $r = $ws.ReceiveAsync($seg, $cts.Token).Result
    if ($r.MessageType -eq [System.Net.WebSockets.WebSocketMessageType]::Close) { throw "OBS closed the connection ($($ws.CloseStatusDescription))" }
    $ms.Write($buf, 0, $r.Count)
  } while (-not $r.EndOfMessage)
  return [Text.Encoding]::UTF8.GetString($ms.ToArray()) | ConvertFrom-Json
}

try {
  $ws.ConnectAsync([Uri]$Url, $cts.Token).Wait()
  $hello = Receive
  if ($hello.op -ne 0) { throw "expected Hello, got op $($hello.op)" }
  if ($hello.d.authentication) { throw "OBS asks for a websocket password. CVM connects without one: turn off authentication in OBS (Tools > WebSocket Server Settings)." }
  Send (@{ op = 1; d = @{ rpcVersion = 1; eventSubscriptions = 0 } } | ConvertTo-Json -Compress)
  $ident = Receive
  if ($ident.op -ne 2) { throw "identification failed (op $($ident.op))" }
} catch {
  $msg = $_.Exception.Message
  if ($_.Exception.InnerException) { $msg = $_.Exception.InnerException.Message }
  [Console]::Error.WriteLine("cannot reach OBS at ${Url}: $msg")
  exit 2
}

$i = 0
foreach ($q in @($reqs)) {
  $i++
  $data = if ($q.requestData) { $q.requestData } else { @{} }
  Send (@{ op = 6; d = @{ requestType = $q.requestType; requestId = "rig-$i"; requestData = $data } } | ConvertTo-Json -Compress -Depth 8)
  do { $m = Receive } while ($m.op -ne 7 -or $m.d.requestId -ne "rig-$i")
  $s = $m.d.requestStatus
  [Console]::Out.WriteLine((@{ requestType = $q.requestType; ok = [bool]$s.result; code = $s.code; comment = $s.comment; data = $m.d.responseData } | ConvertTo-Json -Compress -Depth 8))
}
try { $ws.CloseAsync([System.Net.WebSockets.WebSocketCloseStatus]::NormalClosure, 'done', $cts.Token).Wait() } catch { }
