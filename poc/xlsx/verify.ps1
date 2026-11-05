# T8 step 3: open out/report.xlsx in Excel through COM and check it.
# Writes out/verify.json and out/sheet-<n>.png. Always quits Excel and releases COM.
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$out = Join-Path $here 'out'
$file = Join-Path $out 'report.xlsx'
$figures = Get-Content (Join-Path $out 'figures.json') -Raw -Encoding utf8 | ConvertFrom-Json
$charts = Get-Content (Join-Path $out 'charts.json') -Raw -Encoding utf8 | ConvertFrom-Json
$expectOrder = @('الفهرس', '|', 'المجتمع', 'العينة', '||', 'الإحصائيات', '|||', 'المصدر')
$seps = @('|', '||', '|||')
$r = [ordered]@{}
$near = { param($a, $b) $null -ne $a -and [math]::Abs([double]$a - [double]$b) -lt 1e-9 }
$before = @(Get-ChildItem $env:TEMP -Filter 'error*.xml' -ErrorAction SilentlyContinue | ForEach-Object FullName)
$xl = New-Object -ComObject Excel.Application
try {
  $xl.Visible = $true
  $xl.DisplayAlerts = $false
  $sw = [Diagnostics.Stopwatch]::StartNew()
  # CorruptLoad = 0 (xlNormalLoad)
  $null = $xl.Workbooks.Open($file, 0, $true, 5, "", "", $true, 2, ",", $false, $false, 0, $false, $false, 0)
  while ($sw.Elapsed.TotalSeconds -lt 180) { try { if ($xl.Workbooks.Count -eq 1 -and $xl.Ready) { break } } catch {}; Start-Sleep -Milliseconds 250 }
  $wb = $xl.Workbooks.Item(1)
  $r.openMs = $sw.ElapsedMilliseconds
  $new = @(Get-ChildItem $env:TEMP -Filter 'error*.xml' -ErrorAction SilentlyContinue | Where-Object { $before -notcontains $_.FullName })
  $r.repairLogs = $new.Count
  $r.caption = $xl.Caption
  $r.normalFont = $wb.Styles.Item('Normal').Font.Name
  $r.sheets = @($wb.Worksheets | ForEach-Object { $_.Name })
  $r.orderOk = (($r.sheets -join ',') -eq ($expectOrder -join ','))
  $r.views = @()
  foreach ($ws in @($wb.Worksheets)) {
    $ws.Activate() | Out-Null
    $w = $xl.ActiveWindow
    $v = [ordered]@{ sheet = $ws.Name; rtl = [bool]$ws.DisplayRightToLeft; gridlines = [bool]$w.DisplayGridlines; headings = [bool]$w.DisplayHeadings; tab = $ws.Tab.Color; frozen = [bool]$w.FreezePanes; shapes = $ws.Shapes.Count; charts = $ws.ChartObjects().Count; listObjects = $ws.ListObjects.Count; pivots = $ws.PivotTables().Count }
    if ($seps -contains $ws.Name) {
      $v.cellsBlack = ($ws.Range('A1').Interior.Color -eq 0) -and ($ws.Range('AZ200').Interior.Color -eq 0) -and ($ws.Range('M30').Interior.Color -eq 0)
      $v.empty = ($xl.WorksheetFunction.CountA($ws.Cells) -eq 0)
    } else { $v.bg = $ws.Range('A30').Interior.Color }
    $r.views += $v
  }
  $pts = @{}
  foreach ($ws in @($wb.Worksheets)) { foreach ($pt in @($ws.PivotTables())) { $pts[$pt.Name] = $pt } }
  $r.pivotCount = $pts.Count
  $readFigures = {
    param($tag)
    foreach ($f in $figures) {
      $pt = $pts[$f.pivot]
      try { if ($f.filter.Count -eq 2) { $v = $pt.GetPivotData($f.dataField, $f.filter[0], $f.filter[1]).Value2 } else { $v = $pt.GetPivotData($f.dataField).Value2 } } catch { $v = $null }
      [ordered]@{ when = $tag; label = $f.label; pivot = $f.pivot; model = $f.value; excel = $v; ok = (& $near $v $f.value) }
    }
  }
  $fig = @(& $readFigures 'open')
  $sw.Restart()
  $r.refreshTable = @($pts.Keys | ForEach-Object { try { "${_}:$($pts[$_].RefreshTable())" } catch { "${_}:ERR $($_.Exception.Message)" } })
  $r.refreshMs = $sw.ElapsedMilliseconds
  $fig += @(& $readFigures 'refresh')
  $r.figuresOk = @($fig | Where-Object { $_.ok }).Count; $r.figuresTotal = $fig.Count
  $r.figures = $fig
  # charts: series values (read from the bound pivot cells) vs the pivot's own GetPivotData and the built cache
  $r.charts = @()
  foreach ($c in $charts) {
    $ws = $wb.Worksheets.Item($c.sheet)
    $pt = $pts[$c.pivot]
    $chart = $null
    # find the chart by its categories and series name
    foreach ($o in @($ws.ChartObjects())) {
      $cats = @($o.Chart.SeriesCollection(1).XValues)
      if (($cats -join '|') -eq (($c.cats) -join '|') -and $o.Chart.SeriesCollection(1).Name -eq $c.dataField) {
        $vals = @($o.Chart.SeriesCollection(1).Values)
        $rowField = $pt.RowFields().Item(1).SourceName
        $okAll = $true
        for ($i = 0; $i -lt $cats.Count; $i++) {
          $item = $cats[$i]; if ($item -match '^\d+$') { $item = [int]$item }
          $pv = $pt.GetPivotData($c.dataField, $rowField, $item).Value2
          if (-not (& $near $vals[$i] $pv) -or -not (& $near $vals[$i] $c.vals[$i])) { $okAll = $false }
        }
        $chart = [ordered]@{ sheet = $c.sheet; chart = $o.Name; pivot = $c.pivot; points = $cats.Count; ok = $okAll }
      }
    }
    if (-not $chart) { $chart = [ordered]@{ sheet = $c.sheet; pivot = $c.pivot; ok = $false; note = 'chart not found by categories' } }
    $r.charts += $chart
  }
  # slicers
  $r.slicerCaches = $wb.SlicerCaches.Count
  $r.slicers = @($wb.SlicerCaches | ForEach-Object { "$($_.Name):$($_.SourceName):slicers=$($_.Slicers.Count)" })
  $sc = $wb.SlicerCaches.Item('Slicer_SmpGroup')
  $p2 = $pts['pivot2']
  $beforeV = $p2.GetPivotData('عدد الدراسات').Value2
  $sc.SlicerItems.Item('منفذ بري').Selected = $false
  $afterV = $p2.GetPivotData('عدد الدراسات').Value2
  $sc.ClearManualFilter()
  $resetV = $p2.GetPivotData('عدد الدراسات').Value2
  $r.pivotSlicerFilter = [ordered]@{ slicer = 'Slicer_SmpGroup'; deselect = 'منفذ بري'; before = $beforeV; after = $afterV; reset = $resetV; ok = ($afterV -eq $beforeV - 85314 -and $resetV -eq $beforeV) }
  $tc = @($wb.SlicerCaches | Where-Object { $_.Name -eq 'Slicer_SmpYear' })[0]
  $r.tableSlicerType = $tc.SlicerCacheType
  if (-not $tc) { throw "no table slicer cache on tblSample; caches: $($r.slicers -join ', ')" }
  $lo = $wb.Worksheets.Item('العينة').ListObjects.Item(1)
  $col = $lo.ListColumns.Item('السنة').DataBodyRange
  $visBefore = $xl.WorksheetFunction.Subtotal(103, $col)
  $n2024 = $xl.WorksheetFunction.CountIf($col, 2024)
  for ($k = 0; $k -lt 20; $k++) { try { $tc.SlicerItems.Item("2024").Selected = $false; break } catch { Start-Sleep -Milliseconds 500 } }
  Start-Sleep -Milliseconds 500
  $visAfter = $xl.WorksheetFunction.Subtotal(103, $col)
  for ($k = 0; $k -lt 20; $k++) { try { $tc.ClearManualFilter(); break } catch { Start-Sleep -Milliseconds 500 } }
  $r.tableSlicerFilter = [ordered]@{ slicer = 'Slicer_SmpYear'; deselect = '2024'; visibleBefore = $visBefore; visibleAfter = $visAfter; rows2024 = $n2024; ok = ($visAfter -eq $visBefore - $n2024 -and $n2024 -gt 0) }
  # hyperlinks: cover buttons and every back button
  $r.links = @()
  foreach ($ws in @($wb.Worksheets)) {
    foreach ($h in @($ws.Hyperlinks)) { $ws.Activate() | Out-Null; $h.Follow(); $target = ($h.SubAddress -replace "^'?(.*?)'?!.*$", '$1'); $r.links += "$($ws.Name):$($h.TextToDisplay)->$($xl.ActiveSheet.Name):$($xl.ActiveSheet.Name -eq $target)" }
  }
  # screenshots
  $r.png = @()
  $areas = @{ 'الفهرس' = 'A1:K21'; '|' = 'A1:N20'; '||' = 'A1:N20'; '|||' = 'A1:N20'; 'المجتمع' = 'A1:Z36'; 'العينة' = 'A1:Z36'; 'الإحصائيات' = 'A1:V64'; 'المصدر' = 'A1:I34' }
  for ($i = 1; $i -le $wb.Worksheets.Count; $i++) {
    $ws = $wb.Worksheets.Item($i); $ws.Activate() | Out-Null
    $rg = $ws.Range($areas[$ws.Name])
    $ok = $false; for ($k = 0; $k -lt 8 -and -not $ok; $k++) { try { $rg.CopyPicture(1, -4147) | Out-Null; $ok = $true } catch { Start-Sleep -Milliseconds 700 } }
    if (-not $ok) { $r.png += "copy failed $($ws.Name)"; continue }
    $co = $ws.ChartObjects().Add(0, 0, $rg.Width, $rg.Height)
    $co.Activate() | Out-Null
    Start-Sleep -Milliseconds 400
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
$r | ConvertTo-Json -Depth 6 | Set-Content (Join-Path $out 'verify.json') -Encoding utf8
"repairLogs=$($r.repairLogs) order=$($r.orderOk) figures=$($r.figuresOk)/$($r.figuresTotal) charts=$(@($r.charts | Where-Object { $_.ok }).Count)/$($r.charts.Count) slicerCaches=$($r.slicerCaches) pivotSlicer=$($r.pivotSlicerFilter.ok) tableSlicer=$($r.tableSlicerFilter.ok) open=$($r.openMs)ms refresh=$($r.refreshMs)ms"
