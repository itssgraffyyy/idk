$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Drawing
$cases=(Get-Content -Raw -Encoding UTF8 'datasets/v1/cases.json' | ConvertFrom-Json).cases
foreach($case in $cases) {
 $bitmap=New-Object System.Drawing.Bitmap(1300,850)
 $g=[System.Drawing.Graphics]::FromImage($bitmap)
 $g.Clear([System.Drawing.Color]::White)
 $font=New-Object System.Drawing.Font('Consolas',22)
 $brush=[System.Drawing.Brushes]::Black
 $x=45; $y=45
 if($case.layout -eq 'B') {$g.Clear([System.Drawing.Color]::FromArgb(245,248,252)); $x=120; $y=90}
 if($case.layout -eq 'C') {$x=200; $y=80; $g.DrawRectangle([System.Drawing.Pens]::Gray,160,40,1050,730)}
 foreach($line in ($case.text -split "`n")) {$g.DrawString($line,$font,$brush,$x,$y); $y+=55}
 if($case.rotation -eq 90) {$bitmap.RotateFlip([System.Drawing.RotateFlipType]::Rotate90FlipNone)}
 $bitmap.Save([IO.Path]::GetFullPath('datasets/v1/documents/'+$case.id+'.png'),[System.Drawing.Imaging.ImageFormat]::Png)
 $font.Dispose(); $g.Dispose(); $bitmap.Dispose()
}
Write-Output ('Rendered '+$cases.Count+' synthetic raster documents')
