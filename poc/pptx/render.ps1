# PoC: export slide 1 to PNG via PowerPoint COM, check P1 (opens) and P2 (chart data editable).
# Always quits PowerPoint and releases COM.
$ErrorActionPreference = 'Stop'
$out = Join-Path $PSScriptRoot 'out'
$pptxPath = Join-Path $out 'poc.pptx'
$png = Join-Path $out 'pptx.png'
$app = $null; $pres = $null
try {
  $app = New-Object -ComObject PowerPoint.Application
  # Open(FileName, ReadOnly, Untitled, WithWindow)
  $pres = $app.Presentations.Open($pptxPath, -1, 0, 0)
  Write-Output "P1 OPEN_OK slides=$($pres.Slides.Count)"
  $pres.Slides(1).Export($png, 'PNG', 1920, 1080)
  Write-Output "EXPORTED $png"

  $chartShape = $null
  foreach ($s in $pres.Slides(1).Shapes) { if ($s.HasChart -eq -1) { $chartShape = $s } }
  if ($null -eq $chartShape) { Write-Output 'P2 NO_CHART' } else {
    $chart = $chartShape.Chart
    $before = @($chart.SeriesCollection(1).Values)[0]
    $chart.ChartData.Activate()
    $wb = $chart.ChartData.Workbook
    $ws = $wb.Worksheets(1)
    Write-Output ("P2 B2_BEFORE=" + $ws.Range('B2').Value2 + " A2=" + $ws.Range('A2').Value2)
    $ws.Range('B2').Value2 = 42
    Start-Sleep -Milliseconds 500
    $after = @($chart.SeriesCollection(1).Values)[0]
    Write-Output "P2 SERIES_BEFORE=$before SERIES_AFTER=$after"
    $wb.Application.Quit()
  }
  $pres.Close()  # not saved
} catch {
  Write-Output "ERROR $($_.Exception.Message)"
} finally {
  if ($pres) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($pres) }
  if ($app) { $app.Quit(); [void][Runtime.InteropServices.Marshal]::ReleaseComObject($app) }
  [GC]::Collect(); [GC]::WaitForPendingFinalizers()
}
