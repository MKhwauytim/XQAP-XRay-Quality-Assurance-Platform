# Creates a Desktop shortcut that launches this app in browser "app mode"
# (its own window, no tabs/address bar) via Chrome or Edge, using the icon
# shipped alongside this script. Safe to re-run — e.g. after moving this
# folder to a new location, re-running repairs the shortcut's target path.

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$indexPath = Join-Path $scriptDir "index.html"
$iconPath  = Join-Path $scriptDir "app-icon.ico"

if (-not (Test-Path $indexPath)) {
    Write-Host "خطأ: لم يتم العثور على index.html في نفس مجلد هذا السكربت." -ForegroundColor Red
    Write-Host "تأكد من تشغيل هذا الملف من داخل مجلد التطبيق دون نقله بمفرده." -ForegroundColor Red
    exit 1
}

$browserCandidates = @(
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
    "$env:LocalAppData\Google\Chrome\Application\chrome.exe",
    "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
    "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"
)

$browserPath = $browserCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1

if (-not $browserPath) {
    Write-Host "خطأ: تعذر العثور على متصفح Chrome أو Edge على هذا الجهاز." -ForegroundColor Red
    Write-Host "يتطلب هذا التطبيق أحد المتصفحين لتفعيل الوصول إلى مجلد العمل." -ForegroundColor Red
    exit 1
}

$resolvedIndex = (Resolve-Path $indexPath).Path
# Build the URI via .NET's Uri class rather than raw string concatenation.
# AbsoluteUri percent-encodes non-ASCII characters (e.g. an Arabic deployment
# folder name) into a pure-ASCII string. That matters because WshShortcut.Save()
# (below) silently ANSI-marshals any literal non-ASCII characters in property
# values to "?" with NO exception -- the shortcut would "succeed" but launch a
# dead URL. A pure-ASCII percent-encoded URI survives that marshaling intact,
# and Chrome/Edge decode the %XX sequences back to the real path correctly.
$fileUri = ([Uri]$resolvedIndex).AbsoluteUri

$desktop = [Environment]::GetFolderPath("Desktop")
$shortcutName = "نظام معالجة بيانات الأشعة.lnk"
$shortcutPath = Join-Path $desktop $shortcutName

# WScript.Shell's CreateShortcut()/Save() marshal the shortcut FILE'S OWN PATH
# through the system's ANSI codepage before touching disk (a legacy WSH
# limitation, independent of PowerShell's own Unicode-clean pipeline). On a
# machine whose "language for non-Unicode programs" can't represent Arabic
# (e.g. an English-locale Windows install, which is common even for
# Arabic-speaking users' organizations), that silently turns the Arabic
# filename into literal "?" characters -- illegal in Windows filenames --
# and Save() throws "Unable to save shortcut". Work around this by having
# WScript.Shell only ever touch an ASCII-safe staging path, then perform the
# final Unicode-named placement with a native filesystem move, which is
# codepage-independent. (Verified: the .lnk's internal property bytes are
# unaffected by this -- only the COM object's handling of its OWN file path
# is ANSI-limited.)
$stagingPath = Join-Path $env:TEMP ("xray-shortcut-" + [Guid]::NewGuid().ToString("N") + ".lnk")

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($stagingPath)
$shortcut.TargetPath = $browserPath
$shortcut.Arguments = "--app=`"$fileUri`" --new-window"
$shortcut.WorkingDirectory = $scriptDir
# .Description intentionally omitted: it is free text (not a URI, so it can't
# be percent-encoded the way Arguments is above) and hits the same
# ANSI-marshaling corruption in WshShortcut.Save(), producing visible "?????"
# mojibake in the shortcut's Properties/tooltip on ANSI-incompatible systems.
# A true fix needs IShellLinkW, which is out of scope for this pure
# WScript.Shell script. No Description is strictly better than a garbled one;
# the shortcut's Desktop filename (Arabic, via the staging-path fix above)
# and its actual launch behavior are unaffected either way.
if (Test-Path $iconPath) {
    $shortcut.IconLocation = (Resolve-Path $iconPath).Path
}
$shortcut.Save()

Move-Item -LiteralPath $stagingPath -Destination $shortcutPath -Force

Write-Host "تم إنشاء اختصار على سطح المكتب: $shortcutName" -ForegroundColor Green
