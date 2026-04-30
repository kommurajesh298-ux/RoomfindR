param(
    [Parameter(Mandatory = $true)]
    [string]$SourceImage,

    [Parameter(Mandatory = $true)]
    [string]$AppRoot,

    [double]$Scale = 0.78
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Drawing

function Get-ResolvedPath([string]$PathValue) {
    return (Resolve-Path -LiteralPath $PathValue).Path
}

function New-PaddedLauncherImage {
    param(
        [string]$InputPath,
        [string]$OutputPath,
        [int]$CanvasSize,
        [double]$InnerScale
    )

    $bitmap = New-Object System.Drawing.Bitmap $CanvasSize, $CanvasSize
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $source = [System.Drawing.Bitmap]::new($InputPath)

    try {
        $backgroundColor = $source.GetPixel(0, 0)
        $graphics.Clear($backgroundColor)
        $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
        $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality

        $drawSize = [int][Math]::Round($CanvasSize * $InnerScale)
        $offset = [int][Math]::Round(($CanvasSize - $drawSize) / 2)

        $graphics.DrawImage($source, $offset, $offset, $drawSize, $drawSize)
        $bitmap.Save($OutputPath, [System.Drawing.Imaging.ImageFormat]::Png)
    }
    finally {
        $source.Dispose()
        $graphics.Dispose()
        $bitmap.Dispose()
    }
}

$resolvedSource = Get-ResolvedPath $SourceImage
$resolvedAppRoot = Get-ResolvedPath $AppRoot
$resRoot = Join-Path $resolvedAppRoot 'android\app\src\main\res'

if (!(Test-Path -LiteralPath $resRoot)) {
    throw "Android resources directory not found: $resRoot"
}

$targets = @(
    @{ Folder = 'mipmap-mdpi'; Size = 48 },
    @{ Folder = 'mipmap-hdpi'; Size = 72 },
    @{ Folder = 'mipmap-xhdpi'; Size = 96 },
    @{ Folder = 'mipmap-xxhdpi'; Size = 144 },
    @{ Folder = 'mipmap-xxxhdpi'; Size = 192 }
)

$fileNames = @(
    'ic_launcher.png',
    'ic_launcher_foreground.png',
    'ic_launcher_round.png'
)

foreach ($target in $targets) {
    $folderPath = Join-Path $resRoot $target.Folder
    if (!(Test-Path -LiteralPath $folderPath)) {
        continue
    }

    foreach ($fileName in $fileNames) {
        $outputPath = Join-Path $folderPath $fileName
        New-PaddedLauncherImage -InputPath $resolvedSource -OutputPath $outputPath -CanvasSize $target.Size -InnerScale $Scale
        Write-Output "Updated $outputPath"
    }
}
