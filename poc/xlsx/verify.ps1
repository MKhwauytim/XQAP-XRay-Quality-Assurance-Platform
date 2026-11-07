# T8 round 3: open out/report.xlsx in Excel through COM and check it.
# Needs out/source-counts.json (sourcecounts.ps1) and the build's figures/charts/buttons/expect json.
# Writes out/verify.json and out/sheet-<n>.png. Always quits Excel and releases COM.
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$out = Join-Path $here 'out'
$file = Join-Path $out 'report.xlsx'
$J = { param($n) Get-Content (Join-Path $out $n) -Raw -Encoding utf8 | ConvertFrom-Json }
$figures = & $J 'figures.json'; $charts = & $J 'charts.json'; $buttons = & $J 'buttons.json'; $expect = & $J 'expect.json'; $source = & $J 'source-counts.json'
$seps = @('|', '||', '|||', '||||', '|||||')
$r = [ordered]@{ fileMB = [math]::Round((Get-Item $file).Length / 1MB, 1) }
$near = { param($a, $b) $null -ne $a -and [math]::Abs([double]$a - [double]$b) -lt 1e-9 }
$retry = { param($sb) for ($rk = 0; $rk -lt 40; $rk++) { try { return (& $sb) } catch { if ($rk -eq 39) { throw }; Start-Sleep -Milliseconds 500 } } }
$before = @(Get-ChildItem $env:TEMP -Filter 'error*.xml' -ErrorAction SilentlyContinue | ForEach-Object FullName)
$xl = New-Object -ComObject Excel.Application
try {
  $xl.Visible = $true
  $xl.DisplayAlerts = $false
  $sw = [Diagnostics.Stopwatch]::StartNew()
  # Open(..., UpdateLinks=0, ReadOnly, ..., CorruptLoad=0 xlNormalLoad)
  $null = $xl.Workbooks.Open($file, 0, $true, 5, "", "", $true, 2, ",", $false, $false, 0, $false, $false, 0)
  while ($sw.Elapsed.TotalSeconds -lt 900) { try { if ($xl.Workbooks.Count -eq 1 -and $xl.Ready) { break } } catch {}; Start-Sleep -Milliseconds 500 }
  $wb = $xl.Workbooks.Item(1)
  $r.openSec = [math]::Round($sw.Elapsed.TotalSeconds, 1)
  $p = Get-Process EXCEL | Sort-Object StartTime -Descending | Select-Object -First 1
  $r.excelMemMB = [math]::Round($p.WorkingSet64 / 1MB)
  $new = @(Get-ChildItem $env:TEMP -Filter 'error*.xml' -ErrorAction SilentlyContinue | Where-Object { $before -notcontains $_.FullName })
  $r.repairLogs = $new.Count
  $r.repairText = ($new | ForEach-Object { Get-Content $_.FullName -Raw }) -join ' | '
  $r.caption = $xl.Caption
  $r.sheets = @($wb.Worksheets | ForEach-Object { $_.Name })
  $r.orderOk = (($r.sheets -join ',') -eq (($expect.order) -join ','))
  # fonts
  $r.normalFont = $wb.Styles.Item('Normal').Font.Name
  $r.themeMinorLatin = $wb.Theme.ThemeFontScheme.MinorFont.Item(1).Name
  $r.themeMajorLatin = $wb.Theme.ThemeFontScheme.MajorFont.Item(1).Name
  # views
  $r.views = @()
  foreach ($ws in @($wb.Worksheets)) {
    $ws.Activate() | Out-Null
    $w = $xl.ActiveWindow
    $v = [ordered]@{ sheet = $ws.Name; rtl = [bool]$ws.DisplayRightToLeft; gridlines = [bool]$w.DisplayGridlines; headings = [bool]$w.DisplayHeadings; tab = $ws.Tab.Color; shapes = $ws.Shapes.Count; charts = $ws.ChartObjects().Count; listObjects = $ws.ListObjects.Count; pivots = $ws.PivotTables().Count }
    if ($seps -contains $ws.Name) { $v.cellsBlack = ($ws.Range('A1').Interior.Color -eq 0) -and ($ws.Range('AZ200').Interior.Color -eq 0); $v.empty = ($xl.WorksheetFunction.CountA($ws.Cells) -eq 0) }
    $r.views += $v
  }
  $r.separatorsOk = @($r.views | Where-Object { $seps -contains $_.sheet -and $_.tab -eq 0 -and -not $_.gridlines -and -not $_.headings -and $_.cellsBlack -and $_.empty -and $_.shapes -eq 0 }).Count -eq $seps.Count
  # raw sheets vs the source workbook
  $r.raw = @()
  foreach ($s in $source.sheets) {
    if ($expect.raw -notcontains $s.name) { continue }
    $ws = $wb.Worksheets.Item($s.name)
    $u = $ws.UsedRange
    $r.raw += [ordered]@{ sheet = $s.name; rows = $u.Rows.Count; cols = $u.Columns.Count; srcRows = $s.rows; srcCols = $s.cols; ok = ($u.Rows.Count -eq $s.rows -and $u.Columns.Count -eq $s.cols -and $u.Row -eq $s.firstRow -and $u.Column -eq $s.firstCol) }
  }
  $r.rawOk = @($r.raw | Where-Object { $_.ok }).Count -eq $expect.raw.Count
  $r.rawSkipped = @($source.sheets | Where-Object { $expect.raw -notcontains $_.name } | ForEach-Object { $_.name })
  # reconciliation
  $lo = @{}
  foreach ($ws in @($wb.Worksheets)) { foreach ($t in @($ws.ListObjects)) { $lo[$t.Name] = $t } }
  $popRows = 0; foreach ($i in 1..$expect.popParts.Count) { $popRows += $lo["جدول_المجتمع_المعالج_$i"].ListRows.Count }
  $rec = @($expect.perSheet | ForEach-Object { [ordered]@{ sheet = $_.sheet; rows = $_.rows; removed = $_.pre + $_.header + $_.dup + $_.noPortDate + $_.cutoff; kept = $_.kept; ok = ($_.rows - $_.pre - $_.header - $_.dup - $_.noPortDate - $_.cutoff -eq $_.kept) -and ($_.rows -eq ($r.raw | Where-Object sheet -eq $_.sheet).rows) } })
  $r.reconcile = [ordered]@{ perSheet = $rec; popKeptExpected = $expect.popKept; popTableRows = $popRows; studyDataRows = $expect.study.dataRows; studyDropped = $expect.study.dropped; sampleTableRows = $lo['جدول_العينة_المعالجة'].ListRows.Count; ok = (@($rec | Where-Object { -not $_.ok }).Count -eq 0) -and ($popRows -eq $expect.popKept) -and ($expect.study.dataRows - $expect.study.dropped -eq $lo['جدول_العينة_المعالجة'].ListRows.Count) }
  # pivots
  $pts = @{}
  foreach ($ws in @($wb.Worksheets)) { foreach ($pt in @($ws.PivotTables())) { $pts[$pt.Name] = $pt } }
  $r.pivotCount = $pts.Count
  $readFigures = {
    param($tag)
    foreach ($f in $figures) {
      $pt = $pts[$f.pivot]
      try { if ($f.filter.Count -eq 2) { $v = $pt.GetPivotData($f.dataField, $f.filter[0], $f.filter[1]).Value2 } else { $v = $pt.GetPivotData($f.dataField).Value2 } } catch { $v = $null }
      $cellV = $wb.Worksheets.Item($f.sheet).Range($f.ref).Value2
      [ordered]@{ when = $tag; label = $f.label; pivot = $f.pivot; model = $f.value; excel = $v; cell = "$($f.sheet)!$($f.ref)"; cellValue = $cellV; ok = (& $near $v $f.value) -and (& $near $cellV $f.value) }
    }
  }
  $fig = @(& $readFigures 'open')
  $sw.Restart()
  $r.refreshTable = @($pts.Keys | ForEach-Object { $k = $_; & $retry { "${k}:$($pts[$k].RefreshTable())" } })
  $r.refreshSec = [math]::Round($sw.Elapsed.TotalSeconds, 1)
  $fig += @(& $readFigures 'refresh')
  $r.figuresOk = @($fig | Where-Object { $_.ok }).Count; $r.figuresTotal = $fig.Count
  $r.figures = $fig
  # charts
  $r.charts = @()
  foreach ($c in $charts) {
    $ws = $wb.Worksheets.Item($c.sheet); $pt = $pts[$c.pivot]; $found = $null
    foreach ($o in @($ws.ChartObjects())) {
      $cats = @($o.Chart.SeriesCollection(1).XValues)
      if (($cats -join '|') -eq (($c.cats) -join '|') -and $o.Chart.SeriesCollection(1).Name -eq $c.dataField) {
        $vals = @($o.Chart.SeriesCollection(1).Values); $rowField = $pt.RowFields().Item(1).SourceName; $okAll = $true
        for ($i = 0; $i -lt $cats.Count; $i++) { $item = $cats[$i]; if ($item -match '^\d+$') { $item = [int]$item }; $pv = $pt.GetPivotData($c.dataField, $rowField, $item).Value2; if (-not (& $near $vals[$i] $pv) -or -not (& $near $vals[$i] $c.vals[$i])) { $okAll = $false } }
        $font = $o.Chart.ChartTitle.Format.TextFrame2.TextRange.Font.Name
        $found = [ordered]@{ sheet = $c.sheet; chart = $o.Name; pivot = $c.pivot; points = $cats.Count; ok = $okAll; titleFont = $font }
      }
    }
    if (-not $found) { $found = [ordered]@{ sheet = $c.sheet; pivot = $c.pivot; ok = $false; note = 'chart not found' } }
    $r.charts += $found
  }
  # slicers
  $r.slicerCaches = $wb.SlicerCaches.Count
  $r.slicers = @($wb.SlicerCaches | ForEach-Object { "$($_.Name):$($_.SourceName):type=$($_.SlicerCacheType)" })
  $sc = @($wb.SlicerCaches | Where-Object { $_.Name -eq 'مقسم_مجموعة_العينة' })[0]
  $p2 = $pts[(@($figures | Where-Object { $_.label -eq 'عينة جميع المنافذ' })[0]).pivot]
  $b0 = $p2.GetPivotData('عدد الدراسات').Value2
  & $retry { $sc.SlicerItems.Item('منفذ بري').Selected = $false } | Out-Null
  $b1 = $p2.GetPivotData('عدد الدراسات').Value2
  & $retry { $sc.ClearManualFilter() } | Out-Null
  $b2 = $p2.GetPivotData('عدد الدراسات').Value2
  $r.pivotSlicerFilter = [ordered]@{ slicer = 'مقسم_مجموعة_العينة'; deselect = 'منفذ بري'; before = $b0; after = $b1; reset = $b2; ok = ($b1 -eq $b0 - 85314 -and $b2 -eq $b0) }
  $tc = @($wb.SlicerCaches | Where-Object { $_.Name -eq 'مقسم_سنة_العينة' })[0]
  $colR = $lo['جدول_العينة_المعالجة'].ListColumns.Item('السنة (مشتقة)').DataBodyRange
  $v0 = $xl.WorksheetFunction.Subtotal(103, $colR); $n24 = $xl.WorksheetFunction.CountIf($colR, 2024)
  & $retry { $tc.SlicerItems.Item('2024').Selected = $false } | Out-Null
  Start-Sleep -Milliseconds 500
  $v1 = $xl.WorksheetFunction.Subtotal(103, $colR)
  & $retry { $tc.ClearManualFilter() } | Out-Null
  $r.tableSlicerFilter = [ordered]@{ slicer = 'مقسم_سنة_العينة'; deselect = '2024'; visibleBefore = $v0; visibleAfter = $v1; rows2024 = $n24; ok = ($v1 -eq $v0 - $n24 -and $n24 -gt 0) }
  # shape buttons
  $r.buttons = @()
  foreach ($b in $buttons) {
    $ws = $wb.Worksheets.Item($b.sheet); $ws.Activate() | Out-Null
    $sh = $ws.Shapes.Item($b.name)
    $font = $sh.TextFrame2.TextRange.Font.Name
    $shape = $sh.AutoShapeType
    & $retry { $sh.Hyperlink.Follow() } | Out-Null
    $r.buttons += [ordered]@{ sheet = $b.sheet; text = $b.text; target = $b.target; landed = $xl.ActiveSheet.Name; ok = ($xl.ActiveSheet.Name -eq $b.target); font = $font; roundedRect = ($shape -eq 5) }
  }
  $r.buttonsOk = @($r.buttons | Where-Object { $_.ok -and $_.roundedRect -and $_.font -eq 'Somar' }).Count
  # cell links: index list, fact cards, source rows
  $r.cellLinks = @()
  foreach ($ws in @($wb.Worksheets)) {
    foreach ($h in @($ws.Hyperlinks)) {
      if ($h.Type -ne 0) { continue } # shape hyperlinks are checked as buttons above
      $ws.Activate() | Out-Null
      $sub = $h.SubAddress; $tSheet = ($sub -replace "^'?(.*?)'?!.*$", '$1'); $tCell = ($sub -replace '^.*!', '')
      & $retry { $h.Follow() } | Out-Null
      $r.cellLinks += [ordered]@{ from = "$($ws.Name)!$($h.Range.Address($false,$false))"; to = $sub; ok = ($xl.ActiveSheet.Name -eq $tSheet -and $xl.ActiveCell.Address($false, $false) -eq $tCell) }
    }
  }
  $r.cellLinksOk = @($r.cellLinks | Where-Object { $_.ok }).Count
  # M15: no visible name may look like an internal id or a numbered step (read back from Excel)
  $idRe = @('(?i)^[a-z]{1,3}\d+$', '\b[a-z]+(?:_[a-z0-9]+)+\b', '\b[a-z]+[A-Z][A-Za-z0-9]*\b', '\btbl', 'خطوة\s*\d', '(?i)\b(?:pivot|Slicer|Chart|Button)\s*_?\d*\b')
  $rawHead = @{}
  foreach ($n in $expect.raw) { $u = $wb.Worksheets.Item($n).UsedRange; foreach ($c in @($u.Rows.Item(1).Cells) + @($u.Rows.Item(2).Cells)) { if ($c.Value2) { $rawHead[[string]$c.Value2] = 1 } } }
  $names = @()
  foreach ($ws in @($wb.Worksheets)) {
    $names += ,@('sheet', $ws.Name)
    if ($expect.raw -contains $ws.Name) { continue }
    foreach ($t in @($ws.ListObjects)) { $names += ,@('table', $t.Name); foreach ($h in @($t.HeaderRowRange.Cells)) { $v = [string]$h.Value2; if (-not $rawHead.ContainsKey($v)) { $names += ,@('header', $v) } } }
    foreach ($pt in @($ws.PivotTables())) { $names += ,@('pivot', $pt.Name); foreach ($df in @($pt.DataFields())) { $names += ,@('measure', $df.Name) } }
    foreach ($sh in @($ws.Shapes)) { $names += ,@('shape', $sh.Name); if ($sh.HasChart -eq -1 -and $sh.Chart.HasTitle) { $names += ,@('chart title', $sh.Chart.ChartTitle.Text) } }
  }
  foreach ($sc in @($wb.SlicerCaches)) { $names += ,@('slicer cache', $sc.Name); foreach ($sl in @($sc.Slicers)) { $names += ,@('slicer', $sl.Name); $names += ,@('slicer caption', $sl.Caption) } }
  $badNames = @($names | Where-Object { $v = $_[1]; @($idRe | Where-Object { $v -cmatch $_ }).Count -gt 0 } | ForEach-Object { "$($_[0]): $($_[1])" })
  $r.nameCheck = [ordered]@{ checked = $names.Count; bad = $badNames; ok = ($badNames.Count -eq 0) }
  $wb.Close($false)
} finally {
  $xl.Quit()
  [void][Runtime.InteropServices.Marshal]::ReleaseComObject($xl)
  [GC]::Collect(); [GC]::WaitForPendingFinalizers()
}
$r | ConvertTo-Json -Depth 6 | Set-Content (Join-Path $out 'verify.json') -Encoding utf8
"size=$($r.fileMB)MB open=$($r.openSec)s mem=$($r.excelMemMB)MB repairLogs=$($r.repairLogs) order=$($r.orderOk) separators=$($r.separatorsOk) raw=$($r.rawOk) reconcile=$($r.reconcile.ok) figures=$($r.figuresOk)/$($r.figuresTotal) charts=$(@($r.charts | Where-Object { $_.ok }).Count)/$($r.charts.Count) slicers=$($r.slicerCaches) pivotSlicer=$($r.pivotSlicerFilter.ok) tableSlicer=$($r.tableSlicerFilter.ok) buttons=$($r.buttonsOk)/$($r.buttons.Count) cellLinks=$($r.cellLinksOk)/$($r.cellLinks.Count) fonts=$($r.normalFont)/$($r.themeMinorLatin) names=$($r.nameCheck.checked)/bad=$($r.nameCheck.bad.Count) refresh=$($r.refreshSec)s"
