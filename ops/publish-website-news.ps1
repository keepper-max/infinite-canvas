param([switch]$Bootstrap)
$ErrorActionPreference = 'Stop'
$website = Join-Path $PSScriptRoot '../website'
$cli = 'H:/CodexStorage/tools/aliyun-cli/aliyun.exe'
$contentPath = Join-Path $website 'content.js'
$contentHash = (Get-FileHash -LiteralPath $contentPath -Algorithm SHA256).Hash.ToLowerInvariant()
$contentBytes = [Convert]::ToBase64String([IO.File]::ReadAllBytes($contentPath))
$runId = [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ') + '-' + [Guid]::NewGuid().ToString('N').Substring(0,8)
$bootstrapFlag = if ($Bootstrap) { 'true' } else { 'false' }
$indexHash = (Get-FileHash -LiteralPath (Join-Path $website 'index.html')).Hash.ToLowerInvariant()
$configHash = (Get-FileHash -LiteralPath (Join-Path $website 'homepage-locations.conf')).Hash.ToLowerInvariant()
$deployedRelease = '/var/www/shoumiren-site/releases/20261017-site02'
if (-not $Bootstrap) {
    # Unpublished local homepage work must not be mistaken for production drift.
    $baseline = Get-Content -Raw -LiteralPath (Join-Path $PSScriptRoot 'releases/website-news-baseline.json') | ConvertFrom-Json
    if ($baseline.directory -notmatch '^/var/www/shoumiren-site/releases/[0-9]{8}-site[0-9]{2}$' -or $baseline.indexSha256 -notmatch '^[a-f0-9]{64}$' -or $baseline.snippetSha256 -notmatch '^[a-f0-9]{64}$') { throw 'Invalid deployed website baseline; refuse publishing' }
    $deployedRelease = $baseline.directory
    $indexHash = $baseline.indexSha256
    $configHash = $baseline.snippetSha256
}
$script = @'
set -eu
umask 077
test "$(hostname)" = iZm5edijeycdxfyte4d9igZ
exec 9>/run/lock/shoumiren-website-news.lock
flock -n 9
release=DEPLOYED_RELEASE
snippet=/etc/nginx/snippets/shoumiren-homepage.conf
content="$release/news-current.js"
bootstrap=BOOTSTRAP_FLAG
if test "$bootstrap" = false; then
  test -s "$content"
  printf '%s  %s\n' 'CONFIG_HASH' "$snippet" 'INDEX_HASH' "$release/index.html" | sha256sum -c -
  if test -f "$content" && test "$(sha256sum "$content" | cut -d' ' -f1)" = CONTENT_HASH; then
    curl -fsS https://shoumiren.online/website-news/current.js -o /tmp/shoumiren-news-verify-RUN_ID
    cmp "$content" /tmp/shoumiren-news-verify-RUN_ID
    printf 'NEWS_UNCHANGED\n'
    exit 0
  fi
else
  printf '%s  %s\n' 'bd1b0159125ba4c069904d477e7142554d82e0d71c59f8eb28fa530a474ed72f' "$snippet" '8178dee54a6d39602bd3283b547fd42de1df076a08017e0f3ec9fc0c63c0837d' "$release/index.html" | sha256sum -c -
  test ! -e "$content"
fi
backup=/root/shoumiren-news-RUN_ID
mkdir "$backup"
cp -p "$release/index.html" "$backup/index.before"
cp -p "$snippet" "$backup/homepage.before"
cp -p /etc/nginx/sites-available/shoumiren-live "$backup/main.before"
if test -f "$content"; then cp -p "$content" "$backup/content.before"; fi
printf '%s' 'CONTENT_BYTES' | base64 -d > "$backup/content.next"
printf '%s  %s\n' CONTENT_HASH "$backup/content.next" | sha256sum -c -
if test "$bootstrap" = true; then
  cp -p "$snippet" "$backup/homepage.next"
  cat >> "$backup/homepage.next" <<'NEWS_LOCATION'
location = /website-news/current.js {
    alias /var/www/shoumiren-site/releases/20261017-site02/news-current.js;
    add_header Cache-Control "no-store" always;
    add_header X-Content-Type-Options "nosniff" always;
}
NEWS_LOCATION
  sed 's@/website-assets/20261017-site02/content-news-20261018.js@/website-news/current.js@' "$release/index.html" > "$backup/index.next"
  printf '%s  %s\n' CONFIG_HASH "$backup/homepage.next" INDEX_HASH "$backup/index.next" | sha256sum -c -
fi
restore() {
  if test -f "$backup/content.before"; then
    install -m 644 "$backup/content.before" "$release/news.rollback"
    mv "$release/news.rollback" "$content"
  fi
  if test "$bootstrap" = true; then
    cp -p "$backup/index.before" "$release/index.rollback"
    mv "$release/index.rollback" "$release/index.html"
    cp -p "$backup/homepage.before" "$snippet"
    nginx -t && systemctl reload nginx
  fi
}
trap 'restore' EXIT
install -m 644 "$backup/content.next" "$release/news.next"
mv "$release/news.next" "$content"
if test "$bootstrap" = true; then
  install -m 644 "$backup/homepage.next" /etc/nginx/snippets/shoumiren-homepage.news-next
  mv /etc/nginx/snippets/shoumiren-homepage.news-next "$snippet"
  nginx -t
  systemctl reload nginx
fi
elapsed=0
until curl -fsS https://shoumiren.online/website-news/current.js -o "$backup/content.public" && cmp -s "$content" "$backup/content.public"; do
  test "$elapsed" -lt 300
  sleep 2
  elapsed=$((elapsed+2))
done
if test "$bootstrap" = true; then
  install -m 644 "$backup/index.next" "$release/index.news-next"
  mv "$release/index.news-next" "$release/index.html"
fi
curl -fsS https://shoumiren.online/ -o "$backup/index.public"
cmp "$release/index.html" "$backup/index.public"
curl -fsS https://canvas.shoumiren.online/api/health/ready >/dev/null
cmp /etc/nginx/sites-available/shoumiren-live "$backup/main.before"
cp -p "$content" "$backup/content.after"
cp -p "$snippet" "$backup/homepage.after"
sha256sum "$content" "$release/index.html" "$snippet"
trap - EXIT
printf 'NEWS_PUBLISHED backup=%s\n' "$backup"
'@
$script = $script.Replace('DEPLOYED_RELEASE',$deployedRelease).Replace('BOOTSTRAP_FLAG',$bootstrapFlag).Replace('RUN_ID',$runId).Replace('CONTENT_HASH',$contentHash).Replace('CONTENT_BYTES',$contentBytes).Replace('INDEX_HASH',$indexHash).Replace('CONFIG_HASH',$configHash)
$encoded = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($script.Replace("`r`n","`n")))
if ($encoded.Length -gt 24576) { throw 'News payload exceeds Cloud Assistant size; keep website content compact before publishing' }
$raw = & $cli ecs RunCommand --RegionId cn-qingdao --InstanceId.1 i-m5edijeycdxfyte4d9ig --Name shoumiren-news-publish --Type RunShellScript --CommandContent $encoded --ContentEncoding Base64 --KeepCommand false
if ($LASTEXITCODE -ne 0) { throw 'Dispatch failed; do not retry without inspecting status' }
$invocationId = ($raw | ConvertFrom-Json).InvokeId
Write-Host "News invocation: $invocationId"
$deadline = [DateTime]::UtcNow.AddSeconds(300)
do {
    Start-Sleep -Seconds 2
    $rawStatus = & $cli ecs DescribeInvocationResults --RegionId cn-qingdao --InvokeId $invocationId
    if ($LASTEXITCODE -ne 0) { throw "Status unavailable; inspect $invocationId before retrying" }
    $result = ($rawStatus | ConvertFrom-Json).Invocation.InvocationResults.InvocationResult | Select-Object -First 1
    if ($result.InvocationStatus -in @('Success','Failed','Stopped','Timeout','Invalid')) {
        if ($result.Output) { Write-Host ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($result.Output))) }
        if ($result.InvocationStatus -ne 'Success') { throw "News publish failed: $($result.InvocationStatus); invocation=$invocationId" }
        return
    }
} while ([DateTime]::UtcNow -lt $deadline)
throw "News result pending; inspect $invocationId before retrying"
