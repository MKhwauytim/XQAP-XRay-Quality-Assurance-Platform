# Opens the raw source workbook read-only in Excel and records each sheet's used-range row and
# column count and the open time to out/source-counts.json (the reference for verify.ps1).
param([Parameter(Mandatory)][string]$Source)
$ErrorActionPreference = 'Stop'
$out = Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) 'out'
$r = [ordered]@{ file = (Split-Path $Source -Leaf); sizeMB = [math]::Round((Get-Item $Source).Length / 1MB, 1) }
$xl = New-Object -ComObject Excel.Application
try {
  $xl.DisplayAlerts = $false
  $sw = [Diagnostics.Stopwatch]::StartNew()
  $null = $xl.Workbooks.Open($Source, 0, $true)
  while ($sw.Elapsed.TotalSeconds -lt 580) { try { if ($xl.Workbooks.Count -eq 1 -and $xl.Ready) { break } } catch {}; Start-Sleep -Milliseconds 500 }
  $r.openSec = [math]::Round($sw.Elapsed.TotalSeconds, 1)
  $wb = $xl.Workbooks.Item(1)
  $r.sheets = @($wb.Worksheets | ForEach-Object { [ordered]@{ name = $_.Name; rows = $_.UsedRange.Rows.Count; cols = $_.UsedRange.Columns.Count; firstRow = $_.UsedRange.Row; firstCol = $_.UsedRange.Column } })
  $wb.Close($false)
} finally { $xl.Quit(); [void][Runtime.InteropServices.Marshal]::ReleaseComObject($xl); [GC]::Collect() }
$r | ConvertTo-Json -Depth 4 | Set-Content (Join-Path $out 'source-counts.json') -Encoding utf8
"source open $($r.openSec) s, $($r.sheets.Count) sheets"
