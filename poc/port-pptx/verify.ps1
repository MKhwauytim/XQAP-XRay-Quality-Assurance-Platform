# T2 step 4: PowerPoint COM checks on out/port-report.pptx.
#   G1  opens, slide count
#   G2/G3 per-slide shape counts (text, table, chart, picture, other)
#   Edit Data on two charts (bar chart on slide 3, timeline on slide 15)
#   PNG export of 4 representative slides
# Writes out/com.json. Always closes without saving and quits PowerPoint.
$ErrorActionPreference = 'Stop'
$out = Join-Path $PSScriptRoot 'out'
$pptxPath = Join-Path $out 'port-report.pptx'
$pngSlides = @(3, 15, 18, 20)
$editSlides = @(3, 15)
$result = [ordered]@{ open = $false; slides = 0; perSlide = @(); edits = @(); pngs = @(); errors = @() }
function LineCount($tr) { $k = 0; while ($true) { try { $l = $tr.Lines($k + 1, 1); if ($l.Length -le 0) { break } } catch { break }; $k++; if ($k -gt 200) { break } }; return $k }
$app = $null; $pres = $null
try {
  $app = New-Object -ComObject PowerPoint.Application
  $pres = $app.Presentations.Open($pptxPath, -1, 0, 0)  # ReadOnly, not Untitled, no window
  $result.open = $true
  $result.slides = $pres.Slides.Count
  for ($i = 1; $i -le $pres.Slides.Count; $i++) {
    $c = [ordered]@{ slide = $i; text = 0; table = 0; chart = 0; picture = 0; other = 0 }
    foreach ($s in $pres.Slides($i).Shapes) {
      if ($s.HasChart -eq -1) { $c.chart++ }
      elseif ($s.HasTable -eq -1) { $c.table++ }
      elseif ($s.Type -eq 13 -or $s.Type -eq 28) { $c.picture++ }
      elseif ($s.HasTextFrame -eq -1 -and $s.TextFrame.HasText -eq -1) { $c.text++ }
      else { $c.other++ }
    }
    $result.perSlide += $c
  }
  # G7b: line count and top-left of every named text box (T<i>) and table cell (TB<i>).
  $result.layout = @()
  for ($i = 1; $i -le $pres.Slides.Count; $i++) {
    foreach ($s in $pres.Slides($i).Shapes) {
      if ($s.Name -match '^T(\d+)$') {
        $result.layout += [ordered]@{ slide = $i; kind = 'text'; idx = [int]$Matches[1]; left = $s.Left; top = $s.Top; lines = (LineCount $s.TextFrame2.TextRange) }
      } elseif ($s.Name -match '^TB(\d+)$' -and $s.HasTable -eq -1) {
        $t = $s.Table; $cells = @()
        for ($r = 1; $r -le $t.Rows.Count; $r++) { for ($c = 1; $c -le $t.Columns.Count; $c++) {
          $tr = $t.Cell($r, $c).Shape.TextFrame2.TextRange
          $cells += ,@($r, $c, $(if ($tr.Length -gt 0) { LineCount $tr } else { 0 }))
        } }
        $result.layout += [ordered]@{ slide = $i; kind = 'table'; idx = [int]$Matches[1]; left = $s.Left; top = $s.Top; cells = $cells }
      }
    }
  }
  for ($i = 1; $i -le $pres.Slides.Count; $i++) { $pres.Slides($i).Export((Join-Path $out ("pptx-{0:d2}.png" -f $i)), 'PNG', 1920, 1080) }
  foreach ($n in $pngSlides) {
    $png = Join-Path $out ("slide-{0:d2}.png" -f $n)
    $pres.Slides($n).Export($png, 'PNG', 1920, 1080)
    $result.pngs += $png
  }
  foreach ($n in $editSlides) {
    $shape = $null
    foreach ($s in $pres.Slides($n).Shapes) { if ($s.HasChart -eq -1 -and $null -eq $shape) { $shape = $s } }
    if ($null -eq $shape) { $result.edits += [ordered]@{ slide = $n; ok = $false; note = 'no chart' }; continue }
    $chart = $shape.Chart
    $before = @($chart.SeriesCollection(1).Values)[0]
    $chart.ChartData.Activate()
    $wb = $chart.ChartData.Workbook
    $ws = $wb.Worksheets(1)
    $a2 = $ws.Range('A2').Value2; $b2 = $ws.Range('B2').Value2
    $ws.Range('B2').Value2 = 42
    Start-Sleep -Milliseconds 700
    $after = @($chart.SeriesCollection(1).Values)[0]
    $wb.Application.Quit()
    $result.edits += [ordered]@{ slide = $n; ok = ($after -eq 42); A2 = "$a2"; B2 = "$b2"; seriesBefore = $before; seriesAfter = $after }
  }
  $pres.Close()
} catch {
  $result.errors += $_.Exception.Message
} finally {
  if ($pres) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($pres) }
  if ($app) { $app.Quit(); [void][Runtime.InteropServices.Marshal]::ReleaseComObject($app) }
  [GC]::Collect(); [GC]::WaitForPendingFinalizers()
}
$result | ConvertTo-Json -Depth 8 | Set-Content -Encoding utf8 (Join-Path $out 'com.json')
"open=$($result.open) slides=$($result.slides) edits=$(($result.edits | ForEach-Object { "$($_.slide):$($_.ok)" }) -join ',') errors=$($result.errors -join ';')"
