# Offline public-file packaging only; never uploads or activates production.
param([string]$OutputRoot = 'H:/CodexStorage/deploy-staging')
$ErrorActionPreference = 'Stop'
$website = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../website'))
$stamp = [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ') + '-' + [Guid]::NewGuid().ToString('N').Substring(0,8)
$stage = Join-Path $OutputRoot "website-learn-$stamp"
$public = Join-Path $stage 'public'
New-Item -ItemType Directory -Path $public -Force | Out-Null
$files = @('index.html','learn/index.html','learn/about.html','learn/credits.html','learn/LICENSE',
    'learn/explore/index.html','learn/explore/app.js','learn/diagnose/index.html',
    'learn/diagnose/style.css','learn/diagnose/app.js','learn/diagnose/engine.js','learn/diagnose/share.js')
$files += @('topics','dependencies','questions','cn-curriculum-standards','id-aliases') | ForEach-Object { "learn/data/$_.json" }
$files += Get-ChildItem -LiteralPath "$website/learn/assets" -File | Where-Object { $_.Extension -in '.css','.js','.png' } | ForEach-Object { 'learn/assets/' + $_.Name }
$files += Get-ChildItem -LiteralPath "$website/learn/assets/vendor" -File | Where-Object { $_.Extension -in '.js','.txt' -or $_.Name -eq 'VENDOR.md' } | ForEach-Object { 'learn/assets/vendor/' + $_.Name }
$files = @($files | Sort-Object -Unique)
$manifest = foreach ($relative in $files) {
    $target = Join-Path $public $relative
    New-Item -ItemType Directory -Force -Path (Split-Path $target) | Out-Null
    Copy-Item -LiteralPath (Join-Path $website $relative) -Destination $target
    '{0}  {1}' -f (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant(), $relative
}
$manifest | Set-Content -LiteralPath "$stage/SHA256SUMS" -Encoding utf8NoBOM
$files | Set-Content -LiteralPath "$stage/public-files.txt" -Encoding utf8NoBOM
Copy-Item -LiteralPath "$website/homepage-locations.conf" -Destination "$stage/homepage.next"
$archive = Join-Path $stage "website-release-$stamp.tgz"
& tar -czf $archive -C $public @files
if ($LASTEXITCODE -ne 0) { throw 'Public archive failed' }
$metadata = [ordered]@{
    archive = $archive
    archiveSha256 = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
    indexSha256 = (Get-FileHash -LiteralPath "$public/index.html" -Algorithm SHA256).Hash.ToLowerInvariant()
    snippetSha256 = (Get-FileHash -LiteralPath "$stage/homepage.next" -Algorithm SHA256).Hash.ToLowerInvariant()
    publicFileCount = $files.Count
}
$metadata | ConvertTo-Json | Set-Content -LiteralPath "$stage/release.json" -Encoding utf8NoBOM
Write-Output "Offline package: $stage"
Write-Output "Public files: $($files.Count); source, tests, reports and news excluded. Not deployed."
