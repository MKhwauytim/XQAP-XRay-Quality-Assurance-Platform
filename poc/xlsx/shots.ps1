# Screenshots of every sheet. In the full 693 MB workbook Excel refuses Range.CopyPicture
# (every attempt fails while it holds ~4 GB), so the pictures are taken from a build with the
# same layout and only the first processed rows: node build.mjs <raw> with T8_LITE=2000, T8_OUT=shots.xlsx.
param([int]$From = 1, [string]$File = (Join-Path (Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) 'out') 'shots.xlsx'))
$ErrorActionPreference = 'Stop'
$out = Split-Path $File -Parent
$seps = @('|', '||', '|||', '||||', '|||||')
$xl = New-Object -ComObject Excel.Application
try {
  $xl.Visible = $true; $xl.DisplayAlerts = $false
  $sw = [Diagnostics.Stopwatch]::StartNew()
  $null = $xl.Workbooks.Open($File, 0, $true, 5, "", "", $true, 2, ",", $false, $false, 0, $false, $false, 0)
  while ($sw.Elapsed.TotalSeconds -lt 600) { try { if ($xl.Workbooks.Count -eq 1 -and $xl.Ready) { break } } catch {}; Start-Sleep -Milliseconds 500 }
  $wb = $xl.Workbooks.Item(1)
  $shot = {
    param($ws, $area, $png)
    $rg = $ws.Range($area)
    $ok = $false; for ($k = 0; $k -lt 10 -and -not $ok; $k++) { try { $rg.CopyPicture(1, -4147) | Out-Null; $ok = $true } catch { Start-Sleep -Milliseconds 700 } }
    if (-not $ok) { return "copy failed $($ws.Name)" }
    $co = $ws.ChartObjects().Add(0, 0, $rg.Width, $rg.Height); $co.Activate() | Out-Null; Start-Sleep -Milliseconds 400
    $co.Chart.Paste() | Out-Null; $co.Chart.Export($png, 'PNG') | Out-Null; $co.Delete() | Out-Null
    $png
  }
  for ($i = $From; $i -le $wb.Worksheets.Count; $i++) {
    $ws = $wb.Worksheets.Item($i); $ws.Activate() | Out-Null; $n = $ws.Name
    $area = if ($seps -contains $n) { 'A1:N20' } elseif ($n -eq 'الفهرس') { 'A1:K58' } elseif ($n -eq 'الإحصائيات') { 'A1:V64' } elseif ($n -match '^(Q4B|\d{4}.*|نتائج الدراسة)$') { 'A1:L30' } elseif ($n -match '^المجتمع \d$' -or $n -eq 'العينة') { 'A1:P30' } elseif ($n -eq 'المصدر') { 'A1:J34' } else { 'A1:V40' }
    & $shot $ws $area (Join-Path $out ("shot-{0:d2}.png" -f ($i - 1)))
  }
  & $shot $wb.Worksheets.Item('المجتمع 1') 'BG1:CA34' (Join-Path $out 'shot-pop-pivot.png')
  & $shot $wb.Worksheets.Item('العينة') 'AO1:BI34' (Join-Path $out 'shot-sample-pivot.png')
  $wb.Close($false)
} finally { $xl.Quit(); [void][Runtime.InteropServices.Marshal]::ReleaseComObject($xl); [GC]::Collect() }

