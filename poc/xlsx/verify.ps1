# T8 step 3: open out/report.xlsx in Excel through COM and check it.
# Writes out/verify.json and out/sheet-<n>.png. Always quits Excel and releases COM.
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$out = Join-Path $here 'out'
$file = Join-Path $out 'report.xlsx'
$figures = Get-Content (Join-Path $out 'figures.json') -Raw -Encoding utf8 | ConvertFrom-Json
$r = [ordered]@{}
$before = @(Get-ChildItem $env:TEMP -Filter 'error*.xml' -ErrorAction SilentlyContinue | ForEach-Object FullName)
$xl = New-Object -ComObject Excel.Application
try {
  $xl.Visible = $true
  $xl.DisplayAlerts = $false
  $sw = [Diagnostics.Stopwatch]::StartNew()
  # Open(FileName, UpdateLinks, ReadOnly, Format, Password, WriteResPassword, IgnoreReadOnly, Origin, Delimiter, Editable, Notify, Converter, AddToMru, Local, CorruptLoad=0 xlNormalLoad)
  $wb = $xl.Workbooks.Open($file, 0, $true, 5, "", "", $true, 2, ",", $false, $false, 0, $false, $false, 0)
  while ($sw.Elapsed.TotalSeconds -lt 180) { try { if ($xl.Workbooks.Count -eq 1 -and $xl.Ready) { break } } catch {}; Start-Sleep -Milliseconds 250 }
  $wb = $xl.Workbooks.Item(1)
  $r.openMs = $sw.ElapsedMilliseconds
  $after = @(Get-ChildItem $env:TEMP -Filter 'error*.xml' -ErrorAction SilentlyContinue | ForEach-Object FullName)
  $new = @($after | Where-Object { $before -notcontains $_ })
  $r.repairLogs = $new.Count
  $r.repairText = ($new | ForEach-Object { Get-Content $_ -Raw }) -join ' | '
  $r.caption = $xl.Caption
  $r.sheets = @($wb.Worksheets | ForEach-Object { $_.Name })
  $r.rtl = @($wb.Worksheets | ForEach-Object { $_.Activate() | Out-Null; [bool]$_.DisplayRightToLeft })
  $r.frozen = @($wb.Worksheets | ForEach-Object { $_.Activate() | Out-Null; [bool]$xl.ActiveWindow.FreezePanes })
  $r.listObjects = @($wb.Worksheets | ForEach-Object { $ws = $_; @($ws.ListObjects | ForEach-Object { "$($ws.Name):$($_.Name):$($_.Range.Address($false,$false)):filter=$($_.ShowAutoFilter)" }) })
  # pivots as opened (refreshOnLoad), before any explicit refresh
  $pts = @{}
  $r.pivotsOnOpen = @($wb.Worksheets | ForEach-Object { $ws = $_; @($ws.PivotTables() | ForEach-Object { $pts[$_.Name] = $_; "$($ws.Name):$($_.Name):$($_.TableRange2.Address($false,$false)):refreshed=$($_.RefreshDate)" }) })
  $cmp = @()
  $readAll = {
    param($tag)
    foreach ($f in $figures) {
      $pt = $pts[$f.pivot]
      try {
        if ($f.filter.Count -eq 2) { $v = $pt.GetPivotData($f.dataField, $f.filter[0], $f.filter[1]).Value2 }
        else { $v = $pt.GetPivotData($f.dataField).Value2 }
      } catch { $v = $null }
      $ok = $null -ne $v -and [math]::Abs([double]$v - [double]$f.value) -lt 1e-9
      [ordered]@{ when = $tag; label = $f.label; pivot = $f.pivot; model = $f.value; excel = $v; ok = $ok }
    }
  }
  $cmp += & $readAll 'open'
  $sw.Restart()
  $refresh = @()
  foreach ($k in $pts.Keys) { try { $refresh += "${k}:$($pts[$k].RefreshTable())" } catch { $refresh += "${k}:ERR $($_.Exception.Message)" } }
  $r.refreshMs = $sw.ElapsedMilliseconds
  $r.refreshTable = $refresh
  $cmp += & $readAll 'refresh'
  $r.figures = $cmp
  $r.figuresOk = @($cmp | Where-Object { $_.ok }).Count
  $r.figuresTotal = $cmp.Count
  # index hyperlinks
  $idx = $wb.Worksheets.Item(1)
  $r.links = @()
  foreach ($h in @($idx.Hyperlinks)) { $idx.Activate() | Out-Null; $h.Follow(); $r.links += "$($h.TextToDisplay)->$($xl.ActiveSheet.Name):$($h.TextToDisplay -eq $xl.ActiveSheet.Name)" }
  # screenshots: CopyPicture of the top of each sheet, pasted into a chart and exported as PNG
  $r.png = @()
  $areas = @('A1:B5', 'A1:J30', 'A1:J30', 'A1:V14', 'A1:G24')
  for ($i = 1; $i -le $wb.Worksheets.Count; $i++) {
    $ws = $wb.Worksheets.Item($i); $ws.Activate() | Out-Null
    $rg = $ws.Range($areas[$i - 1])
    $ok=$false; for ($k=0; $k -lt 8 -and -not $ok; $k++) { try { $rg.CopyPicture(1, -4147) | Out-Null; $ok=$true } catch { Start-Sleep -Milliseconds 700 } }; if (-not $ok) { $r.png += "copy failed sheet $i"; continue }
    $co = $ws.ChartObjects().Add(0, 0, $rg.Width, $rg.Height)
    $co.Activate() | Out-Null
    Start-Sleep -Milliseconds 300
    $co.Chart.Paste() | Out-Null
    $png = Join-Path $out "sheet-$($i - 1).png"
    $co.Chart.Export($png, 'PNG') | Out-Null
    $co.Delete() | Out-Null
    $r.png += $png
  }
  $wb.Close($false)
} finally {
  $xl.Quit()
  [void][Runtime.InteropServices.Marshal]::ReleaseComObject($xl)
  [GC]::Collect(); [GC]::WaitForPendingFinalizers()
}
$r | ConvertTo-Json -Depth 5 | Set-Content (Join-Path $out 'verify.json') -Encoding utf8
"repairLogs=$($r.repairLogs) open=$($r.openMs)ms refresh=$($r.refreshMs)ms figures=$($r.figuresOk)/$($r.figuresTotal)"





