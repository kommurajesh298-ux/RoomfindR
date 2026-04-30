param(
    [string]$SourcePath = (Join-Path $PSScriptRoot 'brand-assets\new=logo.jpeg'),
    [string]$RepoRoot = $PSScriptRoot
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Drawing

$Brand = @{
    BlueDeep  = [System.Drawing.ColorTranslator]::FromHtml('#1060D0')
    Blue      = [System.Drawing.ColorTranslator]::FromHtml('#2070E0')
    BlueLight = [System.Drawing.ColorTranslator]::FromHtml('#4090F0')
    Ivory     = [System.Drawing.ColorTranslator]::FromHtml('#F0F0F0')
    Gold      = [System.Drawing.ColorTranslator]::FromHtml('#F0D030')
    Coral     = [System.Drawing.ColorTranslator]::FromHtml('#F05040')
}

function New-DirectoryIfMissing {
    param([string]$Path)
    if (-not (Test-Path $Path)) {
        New-Item -ItemType Directory -Path $Path -Force | Out-Null
    }
}

function Save-Png {
    param(
        [System.Drawing.Bitmap]$Bitmap,
        [string]$Destination
    )

    New-DirectoryIfMissing -Path ([System.IO.Path]::GetDirectoryName($Destination))
    $tempPath = "$Destination.tmp.png"
    if (Test-Path $tempPath) {
        Remove-Item $tempPath -Force
    }
    $Bitmap.Save($tempPath, [System.Drawing.Imaging.ImageFormat]::Png)
    if (Test-Path $Destination) {
        Remove-Item $Destination -Force
    }
    Move-Item -Path $tempPath -Destination $Destination -Force
    Write-Host "Updated: $Destination"
}

function Get-BackgroundColor {
    param([System.Drawing.Bitmap]$Bitmap)

    $samples = @(
        $Bitmap.GetPixel(10, 10),
        $Bitmap.GetPixel($Bitmap.Width - 11, 10),
        $Bitmap.GetPixel(10, $Bitmap.Height - 11),
        $Bitmap.GetPixel($Bitmap.Width - 11, $Bitmap.Height - 11)
    )

    $r = [int](($samples | Measure-Object -Property R -Average).Average)
    $g = [int](($samples | Measure-Object -Property G -Average).Average)
    $b = [int](($samples | Measure-Object -Property B -Average).Average)
    return [System.Drawing.Color]::FromArgb(255, $r, $g, $b)
}

function Get-ColorDistance {
    param(
        [System.Drawing.Color]$A,
        [System.Drawing.Color]$B
    )

    $dr = [double]($A.R - $B.R)
    $dg = [double]($A.G - $B.G)
    $db = [double]($A.B - $B.B)
    return [Math]::Sqrt(($dr * $dr) + ($dg * $dg) + ($db * $db))
}

function Get-ForegroundBounds {
    param(
        [System.Drawing.Bitmap]$Bitmap,
        [double]$Threshold = 72
    )

    $background = Get-BackgroundColor -Bitmap $Bitmap

    $minX = $Bitmap.Width
    $minY = $Bitmap.Height
    $maxX = 0
    $maxY = 0
    $found = $false

    for ($y = 0; $y -lt $Bitmap.Height; $y += 2) {
        for ($x = 0; $x -lt $Bitmap.Width; $x += 2) {
            $pixel = $Bitmap.GetPixel($x, $y)
            if ((Get-ColorDistance -A $pixel -B $background) -gt $Threshold) {
                $found = $true
                if ($x -lt $minX) { $minX = $x }
                if ($y -lt $minY) { $minY = $y }
                if ($x -gt $maxX) { $maxX = $x }
                if ($y -gt $maxY) { $maxY = $y }
            }
        }
    }

    if (-not $found) {
        return [System.Drawing.Rectangle]::new(0, 0, $Bitmap.Width, $Bitmap.Height)
    }

    $paddingX = [int]($Bitmap.Width * 0.05)
    $paddingY = [int]($Bitmap.Height * 0.06)

    $left = [Math]::Max(0, $minX - $paddingX)
    $top = [Math]::Max(0, $minY - $paddingY)
    $right = [Math]::Min($Bitmap.Width - 1, $maxX + $paddingX)
    $bottom = [Math]::Min($Bitmap.Height - 1, $maxY + $paddingY)

    return [System.Drawing.Rectangle]::new($left, $top, ($right - $left + 1), ($bottom - $top + 1))
}

function New-Bitmap {
    param(
        [int]$Width,
        [int]$Height
    )

    return [System.Drawing.Bitmap]::new($Width, $Height, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
}

function Use-HighQualityGraphics {
    param([System.Drawing.Graphics]$Graphics)

    $Graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $Graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $Graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $Graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $Graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
}

function New-ScaledBitmap {
    param(
        [System.Drawing.Image]$Source,
        [int]$Width,
        [int]$Height,
        [ValidateSet('Contain', 'Cover')]
        [string]$Mode = 'Contain',
        [System.Drawing.Color]$Background = [System.Drawing.Color]::Transparent
    )

    $bitmap = New-Bitmap -Width $Width -Height $Height
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    try {
        Use-HighQualityGraphics -Graphics $graphics
        $graphics.Clear($Background)

        $scaleX = $Width / $Source.Width
        $scaleY = $Height / $Source.Height
        $scale = if ($Mode -eq 'Cover') { [Math]::Max($scaleX, $scaleY) } else { [Math]::Min($scaleX, $scaleY) }

        $drawWidth = [int][Math]::Round($Source.Width * $scale)
        $drawHeight = [int][Math]::Round($Source.Height * $scale)
        $drawX = [int][Math]::Round(($Width - $drawWidth) / 2)
        $drawY = [int][Math]::Round(($Height - $drawHeight) / 2)

        $graphics.DrawImage($Source, $drawX, $drawY, $drawWidth, $drawHeight)
    }
    finally {
        $graphics.Dispose()
    }

    return $bitmap
}

function New-CroppedBitmap {
    param(
        [System.Drawing.Image]$Source,
        [System.Drawing.Rectangle]$Crop
    )

    $bitmap = New-Bitmap -Width $Crop.Width -Height $Crop.Height
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    try {
        Use-HighQualityGraphics -Graphics $graphics
        $graphics.DrawImage(
            $Source,
            [System.Drawing.Rectangle]::new(0, 0, $Crop.Width, $Crop.Height),
            $Crop,
            [System.Drawing.GraphicsUnit]::Pixel
        )
    }
    finally {
        $graphics.Dispose()
    }

    return $bitmap
}

function New-RoundedRectanglePath {
    param(
        [System.Drawing.RectangleF]$Rectangle,
        [single]$Radius
    )

    $diameter = $Radius * 2
    $path = [System.Drawing.Drawing2D.GraphicsPath]::new()

    $path.AddArc($Rectangle.X, $Rectangle.Y, $diameter, $diameter, 180, 90)
    $path.AddArc($Rectangle.Right - $diameter, $Rectangle.Y, $diameter, $diameter, 270, 90)
    $path.AddArc($Rectangle.Right - $diameter, $Rectangle.Bottom - $diameter, $diameter, $diameter, 0, 90)
    $path.AddArc($Rectangle.X, $Rectangle.Bottom - $diameter, $diameter, $diameter, 90, 90)
    $path.CloseFigure()
    return $path
}

function Set-LauncherColor {
    param([string]$Path)

    if (Test-Path $Path) {
        $xml = Get-Content $Path -Raw
        $xml = [regex]::Replace($xml, '#[0-9A-Fa-f]{6}', '#2070E0')
        Set-Content -Path $Path -Value $xml -Encoding UTF8
        Write-Host "Updated: $Path"
    }
}

function Update-Banner {
    param(
        [string]$Path,
        [string]$Eyebrow,
        [string]$LineOne,
        [string]$LineTwo,
        [System.Drawing.Color]$LineTwoColor
    )

    if (-not (Test-Path $Path)) {
        return
    }

    $original = [System.Drawing.Bitmap]::FromFile($Path)
    $banner = New-Bitmap -Width $original.Width -Height $original.Height
    $graphics = [System.Drawing.Graphics]::FromImage($banner)

    try {
        Use-HighQualityGraphics -Graphics $graphics
        $graphics.DrawImage($original, 0, 0, $original.Width, $original.Height)

        $overlayRect = [System.Drawing.RectangleF]::new(
            [single]($original.Width * 0.42),
            [single]($original.Height * 0.05),
            [single]($original.Width * 0.54),
            [single]($original.Height * 0.90)
        )
        $overlayPath = New-RoundedRectanglePath -Rectangle $overlayRect -Radius ([single]($original.Height * 0.09))
        $overlayBaseBrush = [System.Drawing.SolidBrush]::new($Brand.BlueDeep)
        $overlayBrush = [System.Drawing.Drawing2D.LinearGradientBrush]::new(
            [System.Drawing.PointF]::new($overlayRect.Left, $overlayRect.Top),
            [System.Drawing.PointF]::new($overlayRect.Right, $overlayRect.Bottom),
            [System.Drawing.Color]::FromArgb(244, $Brand.BlueDeep),
            [System.Drawing.Color]::FromArgb(236, $Brand.Blue)
        )
        $outlinePen = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(80, $Brand.Ivory), [single]2)
        $graphics.FillPath($overlayBaseBrush, $overlayPath)
        $graphics.FillPath($overlayBrush, $overlayPath)
        $graphics.DrawPath($outlinePen, $overlayPath)

        $pillRect = [System.Drawing.RectangleF]::new(
            $overlayRect.Left + ($overlayRect.Width * 0.08),
            $overlayRect.Top + ($overlayRect.Height * 0.09),
            $overlayRect.Width * 0.36,
            $overlayRect.Height * 0.12
        )
        $pillPath = New-RoundedRectanglePath -Rectangle $pillRect -Radius ([single]($pillRect.Height / 2))
        $pillBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(220, $Brand.Ivory))
        $graphics.FillPath($pillBrush, $pillPath)

        $eyebrowFont = [System.Drawing.Font]::new('Segoe UI Semibold', [single]($original.Height * 0.055), [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
        $headlineFont = [System.Drawing.Font]::new('Segoe UI', [single]($original.Height * 0.17), [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
        $sublineFont = [System.Drawing.Font]::new('Segoe UI', [single]($original.Height * 0.21), [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
        $eyebrowBrush = [System.Drawing.SolidBrush]::new($Brand.BlueDeep)
        $lineOneBrush = [System.Drawing.SolidBrush]::new($Brand.Ivory)
        $lineTwoBrush = [System.Drawing.SolidBrush]::new($LineTwoColor)
        $accentBrush = [System.Drawing.SolidBrush]::new($Brand.Coral)

        $graphics.DrawString(
            $Eyebrow,
            $eyebrowFont,
            $eyebrowBrush,
            [System.Drawing.PointF]::new($pillRect.Left + ($pillRect.Width * 0.11), $pillRect.Top + ($pillRect.Height * 0.17))
        )
        $graphics.DrawString(
            $LineOne,
            $headlineFont,
            $lineOneBrush,
            [System.Drawing.PointF]::new($overlayRect.Left + ($overlayRect.Width * 0.08), $overlayRect.Top + ($overlayRect.Height * 0.27))
        )
        $graphics.DrawString(
            $LineTwo,
            $sublineFont,
            $lineTwoBrush,
            [System.Drawing.PointF]::new($overlayRect.Left + ($overlayRect.Width * 0.08), $overlayRect.Top + ($overlayRect.Height * 0.50))
        )
        $graphics.FillRectangle(
            $accentBrush,
            $overlayRect.Left + ($overlayRect.Width * 0.08),
            $overlayRect.Bottom - ($overlayRect.Height * 0.15),
            $overlayRect.Width * 0.3,
            [single]($original.Height * 0.018)
        )

        $eyebrowFont.Dispose()
        $headlineFont.Dispose()
        $sublineFont.Dispose()
        $eyebrowBrush.Dispose()
        $lineOneBrush.Dispose()
        $lineTwoBrush.Dispose()
        $accentBrush.Dispose()
        $pillBrush.Dispose()
        $overlayBaseBrush.Dispose()
        $overlayBrush.Dispose()
        $outlinePen.Dispose()
        $pillPath.Dispose()
        $overlayPath.Dispose()

        $original.Dispose()
        $original = $null
        Save-Png -Bitmap $banner -Destination $Path
    }
    finally {
        $graphics.Dispose()
        $banner.Dispose()
        if ($null -ne $original) {
            $original.Dispose()
        }
    }
}

if (-not (Test-Path $SourcePath)) {
    throw "Source logo not found: $SourcePath"
}

$sourceBitmap = [System.Drawing.Bitmap]::FromFile($SourcePath)
$inlineBounds = Get-ForegroundBounds -Bitmap $sourceBitmap
$inlineMaster = New-CroppedBitmap -Source $sourceBitmap -Crop $inlineBounds
$squareMaster = New-ScaledBitmap -Source $sourceBitmap -Width 1024 -Height 1024 -Mode 'Contain'

try {
    $brandAssets = Join-Path $RepoRoot 'brand-assets'
    Save-Png -Bitmap $squareMaster -Destination (Join-Path $brandAssets 'RoomFindR-Logo-Final.png')
    Save-Png -Bitmap $inlineMaster -Destination (Join-Path $brandAssets 'roomfinder-logo-text.png')
    Save-Png -Bitmap $inlineMaster -Destination (Join-Path $brandAssets 'logo-inline.png')

    $apps = @(
        @{
            Name = 'customer-app'
            Public = Join-Path $RepoRoot 'customer-app\public'
            LogoDir = Join-Path $RepoRoot 'customer-app\public\assets\images\logos'
            Resources = Join-Path $RepoRoot 'customer-app\resources'
            AndroidRes = Join-Path $RepoRoot 'customer-app\android\app\src\main\res'
            BannerDir = Join-Path $RepoRoot 'customer-app\public\assets\images\banners'
        },
        @{
            Name = 'owner-app'
            Public = Join-Path $RepoRoot 'owner-app\public'
            LogoDir = Join-Path $RepoRoot 'owner-app\public\assets\images\logos'
            Resources = Join-Path $RepoRoot 'owner-app\resources'
            AndroidRes = Join-Path $RepoRoot 'owner-app\android\app\src\main\res'
            BannerDir = $null
        },
        @{
            Name = 'admin-panel'
            Public = Join-Path $RepoRoot 'admin-panel\public'
            LogoDir = Join-Path $RepoRoot 'admin-panel\public\assets\images\logos'
            Resources = Join-Path $RepoRoot 'admin-panel\resources'
            AndroidRes = Join-Path $RepoRoot 'admin-panel\android\app\src\main\res'
            BannerDir = $null
        }
    )

    foreach ($app in $apps) {
        $squareTargets = @(
            'logo.png',
            'logo-final-v2.png',
            'roomfindr-logo.png',
            'roomfinder-logo.png',
            'roomfinder-logo-icon.png',
            'splash-logo-new.png'
        )
        $inlineTargets = @(
            'roomfinder-logo-text.png',
            'navbar-logo-new.png',
            'logo-inline.png'
        )

        foreach ($target in $squareTargets) {
            Save-Png -Bitmap $squareMaster -Destination (Join-Path $app.LogoDir $target)
        }

        foreach ($target in $inlineTargets) {
            Save-Png -Bitmap $inlineMaster -Destination (Join-Path $app.LogoDir $target)
        }

        $publicTargets = @(
            'logo192.png',
            'logo512.png',
            'RoomFindR-logo.png'
        )
        foreach ($target in $publicTargets) {
            $size = if ($target -eq 'logo512.png') { 512 } elseif ($target -eq 'logo192.png') { 192 } else { 1024 }
            $bitmap = New-ScaledBitmap -Source $sourceBitmap -Width $size -Height $size -Mode 'Contain'
            try {
                Save-Png -Bitmap $bitmap -Destination (Join-Path $app.Public $target)
            }
            finally {
                $bitmap.Dispose()
            }
        }

        if ($app.Name -eq 'customer-app') {
            foreach ($size in @(192, 512)) {
                $bitmap = New-ScaledBitmap -Source $sourceBitmap -Width $size -Height $size -Mode 'Contain'
                try {
                    Save-Png -Bitmap $bitmap -Destination (Join-Path $app.Public "pwa-$size`x$size.png")
                }
                finally {
                    $bitmap.Dispose()
                }
            }
        }

        if ($app.Resources -and (Test-Path $app.Resources)) {
            $iconPath = Join-Path $app.Resources 'icon.png'
            $splashPath = Join-Path $app.Resources 'splash.png'

            $iconBitmap = New-ScaledBitmap -Source $sourceBitmap -Width 1024 -Height 1024 -Mode 'Contain'
            try {
                Save-Png -Bitmap $iconBitmap -Destination $iconPath
            }
            finally {
                $iconBitmap.Dispose()
            }

            $splashBitmap = New-Bitmap -Width 2732 -Height 2732
            $splashGraphics = [System.Drawing.Graphics]::FromImage($splashBitmap)
            try {
                Use-HighQualityGraphics -Graphics $splashGraphics
                $splashGraphics.Clear($Brand.Ivory)
                $hero = New-ScaledBitmap -Source $inlineMaster -Width 1850 -Height 1150 -Mode 'Contain'
                try {
                    $drawX = [int](($splashBitmap.Width - $hero.Width) / 2)
                    $drawY = [int](($splashBitmap.Height - $hero.Height) / 2)
                    $splashGraphics.DrawImage($hero, $drawX, $drawY, $hero.Width, $hero.Height)
                }
                finally {
                    $hero.Dispose()
                }
                Save-Png -Bitmap $splashBitmap -Destination $splashPath
            }
            finally {
                $splashGraphics.Dispose()
                $splashBitmap.Dispose()
            }
        }

        if ($app.AndroidRes -and (Test-Path $app.AndroidRes)) {
            $launcherBackgroundXml = Join-Path $app.AndroidRes 'values\ic_launcher_background.xml'
            Set-LauncherColor -Path $launcherBackgroundXml

            $rasterTargets = Get-ChildItem $app.AndroidRes -Recurse -File |
                Where-Object { $_.Extension -eq '.png' -and $_.Name -match '^(ic_launcher|splash)' }

            foreach ($target in $rasterTargets) {
                $existing = [System.Drawing.Bitmap]::FromFile($target.FullName)
                try {
                    $existingWidth = $existing.Width
                    $existingHeight = $existing.Height
                }
                finally {
                    $existing.Dispose()
                }

                if ($target.Name -eq 'ic_launcher_background.png') {
                    $bitmap = New-Bitmap -Width $existingWidth -Height $existingHeight
                    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
                    try {
                        Use-HighQualityGraphics -Graphics $graphics
                        $graphics.Clear($Brand.Blue)
                    }
                    finally {
                        $graphics.Dispose()
                    }
                }
                elseif ($target.Name -eq 'ic_launcher_foreground.png') {
                    $bitmap = New-ScaledBitmap -Source $sourceBitmap -Width $existingWidth -Height $existingHeight -Mode 'Contain'
                }
                elseif ($target.Name -like 'ic_launcher*') {
                    $bitmap = New-ScaledBitmap -Source $sourceBitmap -Width $existingWidth -Height $existingHeight -Mode 'Contain'
                }
                else {
                    $bitmap = New-Bitmap -Width $existingWidth -Height $existingHeight
                    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
                    try {
                        Use-HighQualityGraphics -Graphics $graphics
                        $graphics.Clear($Brand.Ivory)
                        $hero = New-ScaledBitmap -Source $inlineMaster -Width ([Math]::Max(1, [int]($existingWidth * 0.72))) -Height ([Math]::Max(1, [int]($existingHeight * 0.52))) -Mode 'Contain'
                        try {
                            $drawX = [int](($existingWidth - $hero.Width) / 2)
                            $drawY = [int](($existingHeight - $hero.Height) / 2)
                            $graphics.DrawImage($hero, $drawX, $drawY, $hero.Width, $hero.Height)
                        }
                        finally {
                            $hero.Dispose()
                        }
                    }
                    finally {
                        $graphics.Dispose()
                    }
                }

                try {
                    Save-Png -Bitmap $bitmap -Destination $target.FullName
                }
                finally {
                    $bitmap.Dispose()
                }
            }
        }

        if ($app.BannerDir) {
            Update-Banner -Path (Join-Path $app.BannerDir 'banner1_taller.png') -Eyebrow 'ROOMFINDR PICKS' -LineOne 'Discover' -LineTwo 'New Places' -LineTwoColor $Brand.Gold
            Update-Banner -Path (Join-Path $app.BannerDir 'banner2_taller.png') -Eyebrow 'BRAND DEALS' -LineOne 'Find Great' -LineTwo 'Deals' -LineTwoColor $Brand.Coral
            Update-Banner -Path (Join-Path $app.BannerDir 'banner3_taller.png') -Eyebrow 'TRAVEL READY' -LineOne 'Plan Your' -LineTwo 'Adventure' -LineTwoColor $Brand.Gold
            Update-Banner -Path (Join-Path $app.BannerDir '1banner.png') -Eyebrow 'ROOMFINDR PICKS' -LineOne 'Discover' -LineTwo 'New Places' -LineTwoColor $Brand.Gold
            Update-Banner -Path (Join-Path $app.BannerDir '2banner.png') -Eyebrow 'BRAND DEALS' -LineOne 'Find Great' -LineTwo 'Deals' -LineTwoColor $Brand.Coral
            Update-Banner -Path (Join-Path $app.BannerDir '3banner.png') -Eyebrow 'TRAVEL READY' -LineOne 'Plan Your' -LineTwo 'Adventure' -LineTwoColor $Brand.Gold
        }
    }

    Write-Host 'Logo refresh complete.'
}
finally {
    $inlineMaster.Dispose()
    $squareMaster.Dispose()
    $sourceBitmap.Dispose()
}
