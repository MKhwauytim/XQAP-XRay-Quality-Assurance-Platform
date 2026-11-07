# PoC tests: open out/t/*.pptx in PowerPoint via COM, export PNGs, dump structure to JSON, crop zooms.
# Never saves the decks. Always quits PowerPoint and releases COM.
# -WithSomar: load the glyf Somar copies for this logon session only (AddFontResourceEx, removed
# at the end, nothing installed) so PowerPoint renders real Somar; writes com-somar.json + somar-*.png.
param([switch]$WithSomar)
$ErrorActionPreference = 'Stop'
$out = Join-Path $PSScriptRoot 'out/t'
$layout = Get-Content (Join-Path $out 'layout.json') -Raw | ConvertFrom-Json
Add-Type -AssemblyName System.Drawing
Add-Type @'
using System; using System.Runtime.InteropServices;
public static class Gdi2 {
  [DllImport("gdi32.dll", CharSet = CharSet.Unicode)] public static extern int AddFontResourceEx(string f, uint fl, IntPtr r);
  [DllImport("gdi32.dll", CharSet = CharSet.Unicode)] public static extern bool RemoveFontResourceEx(string f, uint fl, IntPtr r);
}
'@
$decks = @('tests', 'tests-embed-eot', 'tests-embed-ttf', 'tests-embed-glyf-eot', 'tests-embed-glyf-ttf')
$pfx = ''; $comFile = 'com.json'
$somarFiles = @((Join-Path $out 'fonts/Somar-Regular-glyf.ttf'), (Join-Path $out 'fonts/Somar-Bold-glyf.ttf'))
if ($WithSomar) { $decks = @('tests'); $pfx = 'somar-'; $comFile = 'com-somar.json'; foreach ($f in $somarFiles) { [void][Gdi2]::AddFontResourceEx($f, 0, [IntPtr]::Zero) } }

function LineCount($tr) {
  $n = 0
  for ($i = 1; $i -le 8; $i++) { if ($tr.Lines($i, 1).Length -gt 0) { $n = $i } else { break } }
  return $n
}
function ShapeInfo($s) {
  $o = [ordered]@{ name = $s.Name; type = $s.Type; left = $s.Left; top = $s.Top; width = $s.Width; height = $s.Height }
  if ($s.HasTextFrame -eq -1 -and $s.TextFrame.HasText -eq -1) { $o.text = $s.TextFrame.TextRange.Text; $o.font = $s.TextFrame.TextRange.Font.NameComplexScript }
  if ($s.Type -eq 5) { $o.nodes = $s.Nodes.Count }
  if ($s.Type -eq 6) {
    $o.items = @(); foreach ($g in $s.GroupItems) { $o.items += [ordered]@{ name = $g.Name; type = $g.Type; connector = $g.Connector; hasText = ($g.HasTextFrame -eq -1); text = $(if ($g.HasTextFrame -eq -1) { $g.TextFrame.TextRange.Text } else { $null }); beginConnected = $(if ($g.Connector -eq -1) { $g.ConnectorFormat.BeginConnected } else { $null }) } }
  }
  if ($s.HasTable -eq -1) {
    $t = $s.Table
    $o.rows = $t.Rows.Count; $o.cols = $t.Columns.Count
    $o.cells = @()
    for ($r = 1; $r -le $t.Rows.Count; $r++) {
      for ($c = 1; $c -le $t.Columns.Count; $c++) {
        $tr = $t.Cell($r, $c).Shape.TextFrame.TextRange
        $o.cells += [ordered]@{ r = $r; c = $c; text = $tr.Text; lines = (LineCount $tr); paras = $tr.Paragraphs().Count }
      }
    }
    $o.rowHeights = @(); for ($r = 1; $r -le $t.Rows.Count; $r++) { $o.rowHeights += $t.Rows($r).Height }
  }
  return $o
}
function Crop($src, $dst, $x, $y, $w, $h, $zoom) {
  $img = [System.Drawing.Image]::FromFile($src)
  $bmp = New-Object System.Drawing.Bitmap ([int]($w * $zoom)), ([int]($h * $zoom))
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = 'HighQualityBicubic'
  $g.DrawImage($img, (New-Object System.Drawing.Rectangle 0, 0, $bmp.Width, $bmp.Height), (New-Object System.Drawing.Rectangle $x, $y, $w, $h), 'Pixel')
  $bmp.Save($dst, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose(); $img.Dispose()
}

$app = $null
$report = [ordered]@{}
try {
  $app = New-Object -ComObject PowerPoint.Application
  foreach ($deck in $decks) {
    $path = Join-Path $out "$deck.pptx"
    $info = [ordered]@{ open = $false }
    $pres = $null
    try {
      $pres = $app.Presentations.Open($path, -1, 0, 0)
      $info.open = $true
      $info.slides = $pres.Slides.Count
      $info.slideW = $pres.PageSetup.SlideWidth; $info.slideH = $pres.PageSetup.SlideHeight
      $info.fonts = @(); foreach ($f in $pres.Fonts) { $info.fonts += [ordered]@{ name = $f.Name; embedded = $f.Embedded; embeddable = $f.Embeddable } }
      $exportAll = ($deck -eq 'tests')
      $info.shapes = @()
      for ($i = 1; $i -le $pres.Slides.Count; $i++) {
        if ($exportAll -or $i -eq 1 -or $i -eq 5) {
          $pres.Slides($i).Export((Join-Path $out ("$pfx$deck-s{0:D2}.png" -f $i)), 'PNG', 1920, 1080)
        }
        if ($exportAll) { foreach ($s in $pres.Slides($i).Shapes) { $x = ShapeInfo $s; $x.slide = $i; $info.shapes += $x } }
      }
      if ($exportAll) {
        # Editability probes (not saved): retype a diagram box and the freeform's text, read back.
        foreach ($s in $pres.Slides($pres.Slides.Count - 1).Shapes) { if ($s.Type -eq 6) { $s.GroupItems(2).TextFrame.TextRange.Text = 'تعديل'; $info.groupEdit = $s.GroupItems(2).TextFrame.TextRange.Text; $s.Left = $s.Left + 10; $info.groupMoved = $s.Left } }
        foreach ($s in $pres.Slides($pres.Slides.Count).Shapes) { if ($s.Type -eq 5) { $s.TextFrame.TextRange.Text = 'نص جديد'; $info.freeEdit = $s.TextFrame.TextRange.Text; $s.Nodes.Insert(1, 0, 0, 10, 10); $info.freeNodesAfterInsert = $s.Nodes.Count } }
      }
      $pres.Close()
    } catch { $info.error = $_.Exception.Message; if ($pres) { try { $pres.Close() } catch {} } }
    finally { if ($pres) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($pres) } }
    $report[$deck] = $info
  }
} finally {
  if ($app) { $app.Quit(); [void][Runtime.InteropServices.Marshal]::ReleaseComObject($app) }
  [GC]::Collect(); [GC]::WaitForPendingFinalizers()
  if ($WithSomar) { foreach ($f in $somarFiles) { [void][Gdi2]::RemoveFontResourceEx($f, 0, [IntPtr]::Zero) } }
}
if ($WithSomar) { $report | ConvertTo-Json -Depth 8 | Set-Content (Join-Path $out $comFile) -Encoding utf8; Write-Output 'done'; exit 0 }
$report | ConvertTo-Json -Depth 8 | Set-Content (Join-Path $out 'com.json') -Encoding utf8
foreach ($c in $layout.crops) {
  $src = Join-Path $out ("tests-s{0:D2}.png" -f [int]$c.slide)
  if (Test-Path $src) { Crop $src (Join-Path $out "zoom-$($c.name).png") $c.x $c.y $c.w $c.h 2 }
}
foreach ($deck in @('tests', 'tests-embed-eot', 'tests-embed-ttf', 'tests-embed-glyf-eot', 'tests-embed-glyf-ttf')) {
  $src = Join-Path $out "$deck-s01.png"
  if (Test-Path $src) { Crop $src (Join-Path $out "zoom-t7-$deck.png") 980 160 900 560 1 }
}
Write-Output "done"
