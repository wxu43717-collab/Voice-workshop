$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$output = Join-Path $projectRoot 'dist\desktop'
New-Item -ItemType Directory -Force -Path $output | Out-Null
$nodePath = (Get-Command node -ErrorAction Stop).Source
Copy-Item -LiteralPath $nodePath -Destination (Join-Path $output 'node.exe') -Force
Add-Type -AssemblyName System.Drawing
$bitmap = New-Object System.Drawing.Bitmap 64,64
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.Clear([System.Drawing.Color]::FromArgb(31,35,39))
$pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(238,116,83)),5
$heights = @(12,25,40,29,16)
for ($i=0; $i -lt 5; $i++) { $x=16+$i*8; $h=$heights[$i]; $graphics.DrawLine($pen,$x,(64-$h)/2,$x,(64+$h)/2) }
$icon = [System.Drawing.Icon]::FromHandle($bitmap.GetHicon())
$iconPath = Join-Path $output 'voice.ico'
$stream = [System.IO.File]::Create($iconPath)
$icon.Save($stream)
$stream.Dispose()
$icon.Dispose()
$pen.Dispose()
$graphics.Dispose()
$bitmap.Dispose()
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$exe = Join-Path $output 'VoiceWorkshop.exe'
& $compiler /nologo /target:winexe /optimize+ /reference:System.Windows.Forms.dll /reference:System.Web.Extensions.dll "/win32icon:$iconPath" "/out:$exe" (Join-Path $projectRoot 'desktop\Launcher.cs')
if ($LASTEXITCODE -ne 0) { throw 'Desktop executable compilation failed.' }
$desktopPath = [Environment]::GetFolderPath('Desktop')
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut((Join-Path $desktopPath '声间配音.lnk'))
$shortcut.TargetPath = $exe
$shortcut.WorkingDirectory = $projectRoot
$shortcut.IconLocation = "$exe,0"
$shortcut.Description = '声间 · 文字配音、录音换声与音色训练'
$shortcut.Save()
Write-Output "Installed: $exe"
Write-Output "Desktop shortcut: $(Join-Path $desktopPath '声间配音.lnk')"
