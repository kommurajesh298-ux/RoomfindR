$ErrorActionPreference = 'Stop'

$sdkRoot = Join-Path $env:LOCALAPPDATA 'Android\Sdk'
$cmdlineToolsRoot = Join-Path $sdkRoot 'cmdline-tools'
$latestDir = Join-Path $cmdlineToolsRoot 'latest'
$zipPath = Join-Path $env:TEMP 'commandlinetools-win-latest.zip'
$extractDir = Join-Path $env:TEMP 'android-cmdline-tools'

New-Item -ItemType Directory -Force -Path $sdkRoot | Out-Null
New-Item -ItemType Directory -Force -Path $cmdlineToolsRoot | Out-Null

if (Test-Path $extractDir) {
    Remove-Item $extractDir -Recurse -Force
}

if (!(Test-Path $zipPath)) {
    throw "Missing archive: $zipPath"
}

Expand-Archive -Path $zipPath -DestinationPath $extractDir -Force

if (Test-Path $latestDir) {
    Remove-Item $latestDir -Recurse -Force
}

New-Item -ItemType Directory -Force -Path $latestDir | Out-Null
Copy-Item (Join-Path $extractDir 'cmdline-tools\*') $latestDir -Recurse -Force

$sdkManager = Join-Path $latestDir 'bin\sdkmanager.bat'
if (!(Test-Path $sdkManager)) {
    throw "sdkmanager not found at $sdkManager"
}

$androidStudioJbr = 'C:\Program Files\Android\Android Studio\jbr'
if (Test-Path $androidStudioJbr) {
    $env:JAVA_HOME = $androidStudioJbr
    $env:Path = "$androidStudioJbr\bin;$env:Path"
}

$env:ANDROID_HOME = $sdkRoot
$env:ANDROID_SDK_ROOT = $sdkRoot

$licenseInput = @('y','y','y','y','y','y','y','y','y','y') -join "`n"
$licenseInput | & $sdkManager --sdk_root=$sdkRoot --licenses | Out-Null

& $sdkManager --sdk_root=$sdkRoot `
    'platform-tools' `
    'platforms;android-34' `
    'build-tools;34.0.0' `
    'cmdline-tools;latest'

Write-Output "ANDROID_SDK_ROOT=$sdkRoot"
Write-Output "SDKMANAGER=$sdkManager"
