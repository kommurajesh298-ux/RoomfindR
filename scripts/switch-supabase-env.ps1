param(
    [ValidateSet('local', 'remote')]
    [string]$Mode = 'remote'
)

$root = Split-Path -Parent $MyInvocation.MyCommand.Path | Split-Path -Parent

function Read-EnvFile($path) {
    $map = @{}
    if (-not (Test-Path $path)) { return $map }
    Get-Content $path | ForEach-Object {
        $line = $_.Trim()
        if (-not $line -or $line.StartsWith('#') -or ($line -notmatch '=')) { return }
        $parts = $line.Split('=', 2)
        $map[$parts[0].Trim()] = $parts[1].Trim()
    }
    return $map
}

function Upsert-EnvLine($lines, $key, $value) {
    $found = $false
    for ($i = 0; $i -lt $lines.Count; $i++) {
        if ($lines[$i] -like "$key=*") {
            $lines[$i] = "$key=$value"
            $found = $true
        }
    }
    if (-not $found) {
        $lines += "$key=$value"
    }
    return $lines
}

$remoteEnv = Read-EnvFile (Join-Path $root '.env')
$localEnv = Read-EnvFile (Join-Path $root 'supabase/.env')

$remoteUrl = $remoteEnv['VITE_SUPABASE_URL']
$remoteAnon = $remoteEnv['VITE_SUPABASE_ANON_KEY']
$localUrl = $localEnv['SUPABASE_URL']
$localAnon = $localEnv['SUPABASE_ANON_KEY']

if ($Mode -eq 'remote' -and (-not $remoteUrl -or -not $remoteAnon)) {
    throw "Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY in .env"
}
if ($Mode -eq 'local' -and (-not $localUrl -or -not $localAnon)) {
    throw "Missing SUPABASE_URL or SUPABASE_ANON_KEY in supabase/.env"
}

$targetUrl = if ($Mode -eq 'remote') { $remoteUrl } else { $localUrl }
$targetAnon = if ($Mode -eq 'remote') { $remoteAnon } else { $localAnon }

$targets = @(
    (Join-Path $root '.env.local'),
    (Join-Path $root 'customer-app/.env'),
    (Join-Path $root 'owner-app/.env'),
    (Join-Path $root 'admin-panel/.env')
)

foreach ($path in $targets) {
    $lines = @()
    if (Test-Path $path) { $lines = Get-Content $path }
    $lines = Upsert-EnvLine $lines 'VITE_SUPABASE_URL' $targetUrl
    $lines = Upsert-EnvLine $lines 'VITE_SUPABASE_ANON_KEY' $targetAnon
    Set-Content -Path $path -Value $lines
    Write-Output "Updated $path"
}

Write-Output "Switched VITE_SUPABASE_* to $Mode"
Write-Output "Restart dev servers to apply changes."
