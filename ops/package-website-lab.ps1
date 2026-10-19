# Offline packaging only. This script never connects to production or changes Nginx.
param([string]$OutputRoot = 'H:/CodexStorage/deploy-staging')
$ErrorActionPreference = 'Stop'
$website = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../website'))
$demo = Join-Path $website 'lab/polytech-tree/dist'
if (-not (Test-Path -LiteralPath "$demo/index.html")) { throw 'Build the independent demo first: npm run build in website/lab/polytech-tree' }
$stamp = [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ') + '-' + [Guid]::NewGuid().ToString('N').Substring(0,8)
$stage = Join-Path $OutputRoot "website-lab-$stamp"
New-Item -ItemType Directory -Path $stage -Force | Out-Null
$files = @('index.html','fusion.css','content.css','content.js','brand-logo.png')
$files += Get-ChildItem -LiteralPath "$website/assets/cases" -File -Filter '*-concept-v1.png' | ForEach-Object { 'assets/cases/' + $_.Name }
$files += @('assets/polytech-tree/case.css','assets/polytech-tree/cover-f67e358e16e5.webp')
$files += Get-ChildItem -LiteralPath $demo -Recurse -File | Where-Object { $_.Name -match '^(index\.html|LICENSE|LICENSE-data\.md|LICENSE-three\.txt|THIRD-PARTY-NOTICES\.txt|dataset-source\.json)$' -or ($_.Directory.Name -eq 'assets' -and $_.Extension -in '.js','.css') } | ForEach-Object { 'lab/polytech-tree/dist/' + [IO.Path]::GetRelativePath($demo,$_.FullName).Replace('\','/') }
$manifest = foreach ($relative in $files) {
    $source = Join-Path $website $relative
    $targetRelative = $relative.Replace('lab/polytech-tree/dist/','lab/polytech-tree/')
    $target = Join-Path $stage $targetRelative
    New-Item -ItemType Directory -Force -Path (Split-Path $target) | Out-Null
    Copy-Item -LiteralPath $source -Destination $target
    '{0}  {1}' -f (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant(), $targetRelative
}
# The homepage consumes the current no-store entry; do not package only the obsolete content.js alias.
Copy-Item -LiteralPath "$website/content.js" -Destination "$stage/news-current.js"
$manifest += '{0}  news-current.js' -f (Get-FileHash -LiteralPath "$stage/news-current.js").Hash.ToLowerInvariant()
$manifest | Set-Content -LiteralPath "$stage/SHA256SUMS" -Encoding utf8NoBOM
tar -czf "$stage.tgz" -C $stage .
if ($LASTEXITCODE -ne 0) { throw 'Archive failed' }
Write-Output "Offline archive: $stage.tgz"
Write-Output 'Not deployed. Nginx route draft and versioned resource mapping must be reviewed before release.'
