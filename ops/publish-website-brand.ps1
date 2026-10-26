param([Parameter(Mandatory)][string]$ScriptPath)
# Executes only an explicitly prepared website release step through the existing edge channel.
$ErrorActionPreference='Stop'
$cli='H:/CodexStorage/tools/aliyun-cli/aliyun.exe'
$script=[IO.File]::ReadAllText((Resolve-Path -LiteralPath $ScriptPath)).Replace("`r`n","`n")
$encoded=[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($script))
if($encoded.Length -gt 24576){throw 'Cloud command exceeds existing size limit'}
$raw=& $cli ecs RunCommand --RegionId cn-qingdao --InstanceId.1 i-m5edijeycdxfyte4d9ig --Name shoumiren-brand-release --Type RunShellScript --CommandContent $encoded --ContentEncoding Base64 --KeepCommand false
if($LASTEXITCODE -ne 0){throw 'Dispatch failed; inspect the existing call before retrying'}
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
        if($result.InvocationStatus -ne 'Success'){throw "Website step failed: $id"};return
    }
}while([DateTime]::UtcNow -lt $deadline)
throw "Pending: inspect $id before retry"
