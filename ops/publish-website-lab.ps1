param([switch]$PrepareOnly,[string]$ArchiveUrl,[string]$ArchivePath)
$ErrorActionPreference='Stop'
$cli='H:/CodexStorage/tools/aliyun-cli/aliyun.exe'
$website=Join-Path $PSScriptRoot '../website'
$release='/var/www/shoumiren-site/releases/20261019-site03'
$backup='/root/shoumiren-homepage-20261019-site03'
function Invoke-WebsiteEdge([string]$Script) {
    $script="set -eu`numask 077`ntest `"`$(hostname)`" = iZm5edijeycdxfyte4d9igZ`nexec 9>/run/lock/shoumiren-website-news.lock`nflock -n 9`n"+$Script
    $encoded=[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($script.Replace("`r`n","`n")))
    if($encoded.Length -gt 24576){throw 'Cloud command exceeds existing size limit'}
    $raw=& $cli ecs RunCommand --RegionId cn-qingdao --InstanceId.1 i-m5edijeycdxfyte4d9ig --Name shoumiren-website-lab-release --Type RunShellScript --CommandContent $encoded --ContentEncoding Base64 --KeepCommand false
    if($LASTEXITCODE -ne 0){throw 'Dispatch failed; inspect before retry'}
    $id=($raw|ConvertFrom-Json).InvokeId
    Write-Host "Website invocation: $id"
    $deadline=[DateTime]::UtcNow.AddSeconds(300)
    do {
        Start-Sleep -Seconds 2
        $raw=& $cli ecs DescribeInvocationResults --RegionId cn-qingdao --InvokeId $id
        if($LASTEXITCODE -ne 0){throw "Status unknown: $id; do not retry"}
        $result=($raw|ConvertFrom-Json).Invocation.InvocationResults.InvocationResult|Select-Object -First 1
        if($result.InvocationStatus -in 'Success','Failed','Stopped','Timeout','Invalid'){
            if($result.Output){Write-Host ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($result.Output)))}
            if($result.InvocationStatus -ne 'Success'){throw "Release failed: $id"};return
        }
    }while([DateTime]::UtcNow -lt $deadline)
    throw "Pending: inspect $id before retry"
}
$configHash=(Get-FileHash "$website/homepage-locations.conf").Hash.ToLowerInvariant()
$indexHash=(Get-FileHash "$website/index.html").Hash.ToLowerInvariant()
if($PrepareOnly){
    if($ArchiveUrl -notmatch '^https://shoumiren\.online/website-release-[a-f0-9-]+\.tgz$'){throw 'Expected temporary archive on existing origin'}
    if(-not (Test-Path -LiteralPath $ArchivePath -PathType Leaf)){throw 'Archive missing'}
    $hash=(Get-FileHash -LiteralPath $ArchivePath).Hash.ToLowerInvariant()
    $stage=$ArchivePath -replace '\.tgz$',''
    $manifest=Get-Content -Raw -LiteralPath "$stage/SHA256SUMS"
    $expected=(@('SHA256SUMS')+@($manifest.Trim() -split "`r?`n"|ForEach-Object{($_ -split '  ',2)[1]})|Sort-Object)-join "`n"
    $config=[Convert]::ToBase64String([IO.File]::ReadAllBytes("$website/homepage-locations.conf"))
    $script=@'
test ! -e RELEASE
test ! -e BACKUP
printf '%s  %s\n' '34ac5916f38e769d18a1f6ded3b0a97a3c0d018964e3f00b64b81c48818ad22f' /etc/nginx/snippets/shoumiren-homepage.conf 'cbc2e76f9cec2956dcf0a2fb0741be6324237aeacce8be32af4d9219bbdd8d7e' /var/www/shoumiren-site/releases/20261017-site02/index.html | sha256sum -c -
mkdir BACKUP RELEASE
cp -p /etc/nginx/snippets/shoumiren-homepage.conf BACKUP/homepage.before
cp -p /etc/nginx/sites-available/shoumiren-live BACKUP/main.before
cp -p /var/www/shoumiren-site/releases/20261017-site02/news-current.js BACKUP/news.before
curl -fsS 'ARCHIVE_URL' -o BACKUP/public-assets.tgz
printf '%s  %s\n' 'ARCHIVE_HASH' BACKUP/public-assets.tgz | sha256sum -c -
printf '%s\n' 'EXPECTED' | LC_ALL=C sort > BACKUP/expected-files
tar -tzf BACKUP/public-assets.tgz | sed 's@^\./@@' | sed '/\/$/d; /^$/d' | LC_ALL=C sort > BACKUP/archive-files
cmp BACKUP/expected-files BACKUP/archive-files
test -z "$(tar -tvzf BACKUP/public-assets.tgz | grep -Ev '^[-d]' || true)"
tar -xzf BACKUP/public-assets.tgz -C RELEASE --no-same-owner
printf '%s' 'MANIFEST_BYTES' | base64 -d > BACKUP/SHA256SUMS
(cd RELEASE && sha256sum -c BACKUP/SHA256SUMS)
# Preserve the current published news, even if the daily workflow ran after local packaging.
cp -p BACKUP/news.before RELEASE/news-current.js
printf '%s' 'CONFIG_BYTES' | base64 -d > RELEASE/homepage-locations.conf
printf '%s  %s\n' 'CONFIG_HASH' RELEASE/homepage-locations.conf 'INDEX_HASH' RELEASE/index.html | sha256sum -c -
find RELEASE -type d -exec chmod 755 {} +
find RELEASE -type f -exec chmod 644 {} +
printf 'WEBSITE_STAGED backup=BACKUP\n'
'@
    $script=$script.Replace('ARCHIVE_URL',$ArchiveUrl).Replace('ARCHIVE_HASH',$hash).Replace('EXPECTED',$expected).Replace('MANIFEST_BYTES',[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($manifest))).Replace('CONFIG_BYTES',$config)
}else{
    $script=@'
test -s BACKUP/homepage.before
cmp /etc/nginx/snippets/shoumiren-homepage.conf BACKUP/homepage.before
cmp /etc/nginx/sites-available/shoumiren-live BACKUP/main.before
# News is refreshed independently; all immutable staged resources must still match.
(cd RELEASE && tr -d '\r' < BACKUP/SHA256SUMS | grep -v '  news-current.js$' | sha256sum -c -)
# Refresh news under the same lock immediately before switching its public alias.
cp -p /var/www/shoumiren-site/releases/20261017-site02/news-current.js RELEASE/news-current.js
printf '%s  %s\n' 'CONFIG_HASH' RELEASE/homepage-locations.conf 'INDEX_HASH' RELEASE/index.html | sha256sum -c -
restore(){ cp -p BACKUP/homepage.before /etc/nginx/snippets/shoumiren-homepage.conf; nginx -t && systemctl reload nginx; }
trap 'restore' EXIT
install -m 644 RELEASE/homepage-locations.conf /etc/nginx/snippets/shoumiren-homepage.conf
nginx -t
systemctl reload nginx
elapsed=0
until curl -fsS https://shoumiren.online/ -o BACKUP/index.public && cmp -s RELEASE/index.html BACKUP/index.public; do
 test "$elapsed" -lt 300; sleep 2; elapsed=$((elapsed+2))
done
curl -fsS https://shoumiren.online/lab/polytech-tree/ -o BACKUP/lab.public
cmp RELEASE/lab/polytech-tree/index.html BACKUP/lab.public
curl -fsS https://shoumiren.online/website-news/current.js -o BACKUP/news.public
cmp RELEASE/news-current.js BACKUP/news.public
curl -fsS https://canvas.shoumiren.online/api/health/ready >/dev/null
curl -fsS https://canvas.shoumiren.online/3d-director/ >/dev/null
cmp /etc/nginx/sites-available/shoumiren-live BACKUP/main.before
cp -p /etc/nginx/snippets/shoumiren-homepage.conf BACKUP/homepage.after
sha256sum RELEASE/index.html /etc/nginx/snippets/shoumiren-homepage.conf
trap - EXIT
printf 'WEBSITE_ACTIVATED backup=BACKUP\n'
'@
}
Invoke-WebsiteEdge ($script.Replace('CONFIG_HASH',$configHash).Replace('INDEX_HASH',$indexHash).Replace('RELEASE',$release).Replace('BACKUP',$backup))
