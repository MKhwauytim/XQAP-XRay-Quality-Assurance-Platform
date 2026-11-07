# PoC T7 reference: let PowerPoint itself embed Somar, to learn the fntdata format it writes.
# Loads a font file for this logon session only (AddFontResourceEx, not installed, nothing written
# to the registry), saves a copy with EmbedTrueTypeFonts, removes the font again, then reopens the
# copy in a fresh PowerPoint (font no longer visible) and exports slide 1.
param([string]$Variant = 'glyf')
$ErrorActionPreference = 'Stop'
$out = Join-Path $PSScriptRoot 'out/t'
Add-Type @'
using System; using System.Runtime.InteropServices;
public static class Gdi {
  [DllImport("gdi32.dll", CharSet = CharSet.Unicode)] public static extern int AddFontResourceEx(string f, uint fl, IntPtr r);
  [DllImport("gdi32.dll", CharSet = CharSet.Unicode)] public static extern bool RemoveFontResourceEx(string f, uint fl, IntPtr r);
  [DllImport("user32.dll")] public static extern IntPtr SendMessageTimeout(IntPtr h, uint m, IntPtr w, IntPtr l, uint f, uint t, out IntPtr r);
}
'@
function Broadcast { $r = [IntPtr]::Zero; [void][Gdi]::SendMessageTimeout([IntPtr]0xffff, 0x001D, [IntPtr]::Zero, [IntPtr]::Zero, 2, 2000, [ref]$r) }
$fontDir = Join-Path $env:LOCALAPPDATA 'Microsoft/Windows/Fonts'
$fonts = if ($Variant -eq 'glyf') { @((Join-Path $out 'fonts/Somar-Regular-glyf.ttf'), (Join-Path $out 'fonts/Somar-Bold-glyf.ttf')) } else { @((Join-Path $fontDir 'Somar-Regular.ttf'), (Join-Path $fontDir 'Somar-Bold.ttf')) }
$saved = Join-Path $out "office-embed-$Variant.pptx"
$res = [ordered]@{ variant = $Variant }

function WithPpt($block) {
  $app = New-Object -ComObject PowerPoint.Application
  try { & $block $app } finally { $app.Quit(); [void][Runtime.InteropServices.Marshal]::ReleaseComObject($app); [GC]::Collect(); [GC]::WaitForPendingFinalizers(); Start-Sleep -Seconds 2 }
}
$res.added = @(); foreach ($f in $fonts) { $res.added += [Gdi]::AddFontResourceEx($f, 0, [IntPtr]::Zero) }
Broadcast
try {
  WithPpt {
    param($app)
    $pres = $app.Presentations.Open((Join-Path $out 'tests.pptx'), -1, 0, 0)
    $pres.Slides(1).Export((Join-Path $out "office-$Variant-loaded-s01.png"), 'PNG', 1920, 1080)
    $res.loadedFonts = @(); foreach ($f in $pres.Fonts) { $res.loadedFonts += "$($f.Name) embeddable=$($f.Embeddable)" }
    try { $pres.SaveAs($saved, 24, -1); $res.saved = $true } catch { $res.saveError = $_.Exception.Message }
    $pres.Close()
  }
} finally {
  foreach ($f in $fonts) { [void][Gdi]::RemoveFontResourceEx($f, 0, [IntPtr]::Zero) }
  Broadcast
}
if (Test-Path $saved) {
  WithPpt {
    param($app)
    $pres = $app.Presentations.Open($saved, -1, 0, 0)
    $pres.Slides(1).Export((Join-Path $out "office-$Variant-reopened-s01.png"), 'PNG', 1920, 1080)
    $res.reopenFonts = @(); foreach ($f in $pres.Fonts) { $res.reopenFonts += "$($f.Name) embedded=$($f.Embedded)" }
    $pres.Close()
  }
}
$res | ConvertTo-Json -Depth 4
