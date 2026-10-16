param([switch]$PrepareOnly, [string]$ArchiveUrl, [string]$ArchivePath = 'H:/CodexStorage/deploy-staging/website-20261017-site02.tgz')
$ErrorActionPreference = 'Stop'
$cli = 'H:/CodexStorage/tools/aliyun-cli/aliyun.exe'
$siteDirectory = Join-Path $PSScriptRoot '../website'
$instance = 'i-m5edijeycdxfyte4d9ig'
$release = '/var/www/shoumiren-site/releases/20261017-site02'
$backup = '/root/shoumiren-homepage-20261017-site02'
$publicFiles = @('index.html','fusion.css','brand-logo.png','content.css','content.js',
    'assets/cases/quality-concept-v1.png','assets/cases/factory-concept-v1.png','assets/cases/canvas-concept-v1.png')
function Invoke-EdgeScript([string]$Script) {
    $script = "set -eu`numask 077`ntest `"`$(hostname)`" = iZm5edijeycdxfyte4d9igZ`n" + $Script
    $encoded = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($script.Replace("`r`n", "`n")))
    if ($encoded.Length -gt 24576) { throw 'Cloud command exceeds documented size limit' }
    $raw = & $cli ecs RunCommand --RegionId cn-qingdao --InstanceId.1 $instance --Name shoumiren-homepage-release --Type RunShellScript --CommandContent $encoded --ContentEncoding Base64 --KeepCommand false
    if ($LASTEXITCODE -ne 0) { throw 'Cloud command dispatch failed' }
    $invocation = $raw | ConvertFrom-Json
    $deadline = [DateTime]::UtcNow.AddSeconds(300)
    do {
        Start-Sleep -Seconds 2
        $resultRaw = & $cli ecs DescribeInvocationResults --RegionId cn-qingdao --InvokeId $invocation.InvokeId
        if ($LASTEXITCODE -ne 0) { throw 'Cloud command status unavailable; inspect invocation before retrying' }
        $result = ($resultRaw | ConvertFrom-Json).Invocation.InvocationResults.InvocationResult | Select-Object -First 1
        if ($result.InvocationStatus -eq 'Success') {
            if ($result.Output) { [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($result.Output)) }
            return
        }
        if ($result.InvocationStatus -in @('Failed', 'Stopped', 'Timeout', 'Invalid')) { throw "Cloud command failed: $($result.InvocationStatus), invocation=$($invocation.InvokeId)" }
    } while ([DateTime]::UtcNow -lt $deadline)
    throw "Cloud command status wait ended: invocation=$($invocation.InvokeId)"
}
if ($PrepareOnly) {
    # Stage only public files, never source/config/secrets, over the existing HTTPS origin.
    if ($ArchiveUrl -notmatch '^https://shoumiren\.online/website-release-[a-f0-9-]+\.tgz$') { throw 'Expected a temporary public asset archive on the existing origin' }
    if (-not (Test-Path -LiteralPath $ArchivePath -PathType Leaf)) { throw 'Local public archive missing' }
    $archiveHash = (Get-FileHash -LiteralPath $ArchivePath -Algorithm SHA256).Hash.ToLowerInvariant()
    $configBytes = [Convert]::ToBase64String([IO.File]::ReadAllBytes((Join-Path $siteDirectory 'homepage-locations.conf')))
    $configHash = (Get-FileHash -LiteralPath (Join-Path $siteDirectory 'homepage-locations.conf') -Algorithm SHA256).Hash.ToLowerInvariant()
    $expectedFiles = ($publicFiles | Sort-Object) -join "`n"
    $manifest = ($publicFiles | ForEach-Object { "{0}  {1}" -f (Get-FileHash -LiteralPath (Join-Path $siteDirectory $_) -Algorithm SHA256).Hash.ToLowerInvariant(), $_ }) -join "`n"
    $stage = @'
test ! -e RELEASE
test ! -e BACKUP
test -s /etc/nginx/snippets/shoumiren-homepage.conf
mkdir -p BACKUP RELEASE
cp -p /etc/nginx/sites-available/shoumiren-live BACKUP/shoumiren-live.before
cp -p /etc/nginx/snippets/shoumiren-homepage.conf BACKUP/homepage.before
curl -fsS 'ARCHIVE_URL' -o BACKUP/public-assets.tgz
printf '%s  %s\n' 'ARCHIVE_HASH' 'BACKUP/public-assets.tgz' | sha256sum -c -
printf '%s\n' 'EXPECTED_FILES' > BACKUP/expected-files
tar -tzf BACKUP/public-assets.tgz | sort > BACKUP/archive-files
cmp BACKUP/expected-files BACKUP/archive-files
test -z "$(tar -tvzf BACKUP/public-assets.tgz | grep -v '^-' || true)"
tar -xzf BACKUP/public-assets.tgz -C RELEASE --no-same-owner
printf '%s\n' 'MANIFEST' > BACKUP/SHA256SUMS
(cd RELEASE && sha256sum -c BACKUP/SHA256SUMS)
printf %s 'CONFIG_BYTES' | base64 -d > RELEASE/homepage-locations.conf
printf '%s  %s\n' 'CONFIG_HASH' 'RELEASE/homepage-locations.conf' | sha256sum -c -
find RELEASE -type d -exec chmod 755 {} +
find RELEASE -type f -exec chmod 644 {} +
sha256sum BACKUP/homepage.before BACKUP/shoumiren-live.before
printf 'Website staged; not activated\n'
'@
    Invoke-EdgeScript ($stage.Replace('RELEASE',$release).Replace('BACKUP',$backup).Replace('ARCHIVE_URL',$ArchiveUrl).Replace('ARCHIVE_HASH',$archiveHash).Replace('EXPECTED_FILES',$expectedFiles).Replace('MANIFEST',$manifest).Replace('CONFIG_BYTES',$configBytes).Replace('CONFIG_HASH',$configHash))
    return
}
$activate = @'
test -s BACKUP/homepage.before
test -s RELEASE/index.html
cmp -s /etc/nginx/sites-available/shoumiren-live BACKUP/shoumiren-live.before
cmp -s /etc/nginx/snippets/shoumiren-homepage.conf BACKUP/homepage.before
(cd RELEASE && sha256sum -c BACKUP/SHA256SUMS)
restore() {
  cp -p BACKUP/homepage.before /etc/nginx/snippets/shoumiren-homepage.conf
  nginx -t && systemctl reload nginx
}
install -m 644 RELEASE/homepage-locations.conf /etc/nginx/snippets/shoumiren-homepage.conf
if ! nginx -t || ! systemctl reload nginx; then restore; exit 1; fi
if ! curl -fsS https://shoumiren.online/ | grep -q '20261017-site02'; then restore; exit 1; fi
for item in content.css content.js cases/quality-concept-v1.png cases/factory-concept-v1.png cases/canvas-concept-v1.png; do
  if ! curl -fsS "https://shoumiren.online/website-assets/20261017-site02/$item" -o /dev/null; then restore; exit 1; fi
done
if ! curl -fsS https://canvas.shoumiren.online/api/health/ready >/dev/null; then restore; exit 1; fi
cp -p /etc/nginx/snippets/shoumiren-homepage.conf BACKUP/homepage.after
sha256sum /etc/nginx/snippets/shoumiren-homepage.conf
printf 'Website activated; old immutable resources retained\n'
'@
Invoke-EdgeScript ($activate.Replace('BACKUP',$backup).Replace('RELEASE',$release))
