# Opens one workbook with CorruptLoad=xlNormalLoad and DisplayAlerts off; prints whether it
# opened and any new Excel recovery log. Used to bisect which added part Excel rejects.
param([string]$File)
$before = @(Get-ChildItem $env:TEMP -Filter 'error*.xml' -ErrorAction SilentlyContinue | ForEach-Object FullName)
$xl = New-Object -ComObject Excel.Application
try {
  $xl.DisplayAlerts = $false
  $wb = $xl.Workbooks.Open($File, 0, $true, 5, "", "", $true, 2, ",", $false, $false, 0, $false, $false, 0)
  $t=[Diagnostics.Stopwatch]::StartNew(); $c=0; while ($t.Elapsed.TotalSeconds -lt 180) { try { $c=$xl.Workbooks.Count; if ($c -eq 1 -and $xl.Ready) { break } } catch {}; Start-Sleep -Milliseconds 500 }
  "opened=$($c -eq 1) readyAfterMs=$($t.ElapsedMilliseconds)"
  if ($xl.Workbooks.Count -eq 1) { $wb.Close($false) }
} finally { $xl.Quit(); [void][Runtime.InteropServices.Marshal]::ReleaseComObject($xl) }
$new = @(Get-ChildItem $env:TEMP -Filter 'error*.xml' -ErrorAction SilentlyContinue | Where-Object { $before -notcontains $_.FullName })
"repairLogs=$($new.Count)"
$new | ForEach-Object { Get-Content $_.FullName -Raw }

