[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$IdentityFile,

    [Parameter(Mandatory = $true)]
    [string]$EcsKnownHostsFile,

    [Parameter(Mandatory = $true)]
    [string]$PhysicalKnownHostsFile,

    [Parameter(Mandatory = $true)]
    [ValidatePattern('^https://[A-Za-z0-9.-]+(?::[0-9]+)?$')]
    [string]$PublicUrl,

    [Parameter(Mandatory = $true)]
    [ValidateRange(1, [int]::MaxValue)]
    [int]$HealthTimeoutSeconds,

    [switch]$PreflightOnly,

    [ValidatePattern('^[A-Za-z0-9.-]+$')]
    [string]$EcsHost = '47.104.87.208',
    [ValidatePattern('^[a-z_][a-z0-9_-]*$')]
    [string]$EcsUser = 'deploy-gateway',
    [int]$ManagementPort = 19222,
    [string]$StagingDirectory = 'H:\CodexStorage\deploy-staging'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Invoke-Native {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Command,
        [Parameter(ValueFromRemainingArguments = $true)]
        [string[]]$Arguments
    )

    & $Command @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$Command failed with exit code $LASTEXITCODE"
    }
}

function Convert-ToSshPath {
    param([Parameter(Mandatory = $true)][string]$Path)
    return ([System.IO.Path]::GetFullPath($Path) -replace '\\', '/')
}

foreach ($requiredFile in @($IdentityFile, $EcsKnownHostsFile, $PhysicalKnownHostsFile)) {
    if (-not (Test-Path -LiteralPath $requiredFile -PathType Leaf)) {
        throw "Required SSH file not found: $requiredFile"
    }
}
if ($ManagementPort -lt 1 -or $ManagementPort -gt 65535) {
    throw 'ManagementPort must be between 1 and 65535'
}

$branch = (Invoke-Native git rev-parse --abbrev-ref HEAD | Out-String).Trim()
if ($branch -ne 'main') {
    throw "Deployment must run from main; current branch is $branch"
}
Invoke-Native git diff --quiet
Invoke-Native git diff --cached --quiet
$targetSha = (Invoke-Native git rev-parse HEAD | Out-String).Trim()
if ($targetSha -notmatch '^[0-9a-f]{40}$') {
    throw 'Unable to resolve a full lowercase Git commit'
}
$remoteLine = (Invoke-Native git ls-remote origin refs/heads/main | Out-String).Trim()
$remoteSha = ($remoteLine -split '\s+')[0]
if ($remoteSha -ne $targetSha) {
    throw "origin/main does not match local HEAD: local=$targetSha remote=$remoteSha"
}

$stagingRoot = [System.IO.Path]::GetFullPath($StagingDirectory)
[System.IO.Directory]::CreateDirectory($stagingRoot) | Out-Null
$runDirectory = [System.IO.Path]::GetFullPath((Join-Path $stagingRoot ("release-{0}-{1}" -f $targetSha.Substring(0, 12), [guid]::NewGuid().ToString('N'))))
$rootPrefix = $stagingRoot.TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
if (-not $runDirectory.StartsWith($rootPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw 'Resolved deployment staging path escaped its configured root'
}
[System.IO.Directory]::CreateDirectory($runDirectory) | Out-Null

$sshConfig = Join-Path $runDirectory 'ssh_config'
$bundlePath = Join-Path $runDirectory ("release-{0}.bundle" -f $targetSha.Substring(0, 12))
$remoteBundle = "/tmp/release-{0}.bundle" -f $targetSha.Substring(0, 12)
$remoteHelper = '/tmp/deploy-release-bundle.sh'
$helperPath = Join-Path $PSScriptRoot 'deploy-release-bundle.sh'

$configText = @"
Host shoumiren-ecs-gateway
    HostName $EcsHost
    User $EcsUser
    IdentityFile "$(Convert-ToSshPath $IdentityFile)"
    IdentitiesOnly yes
    UserKnownHostsFile "$(Convert-ToSshPath $EcsKnownHostsFile)"
    StrictHostKeyChecking yes
    RequestTTY no

Host shoumiren-production
    HostName 127.0.0.1
    Port $ManagementPort
    User adminsun
    IdentityFile "$(Convert-ToSshPath $IdentityFile)"
    IdentitiesOnly yes
    UserKnownHostsFile "$(Convert-ToSshPath $PhysicalKnownHostsFile)"
    StrictHostKeyChecking yes
    RequestTTY no
    ProxyJump shoumiren-ecs-gateway
"@
[System.IO.File]::WriteAllText($sshConfig, $configText, [System.Text.UTF8Encoding]::new($false))

try {
    $roleOutput = (Invoke-Native ssh.exe -F $sshConfig shoumiren-production 'set -eu; test "$(hostname)" = shoumiren; docker inspect infinite-canvas --format="host=$(hostname) image={{.Config.Image}} workdir={{index .Config.Labels \"com.docker.compose.project.working_dir\"}}"' | Out-String).Trim()
    Write-Output "Production target verified: $roleOutput"

    if ($PreflightOnly) {
        foreach ($path in @('/healthz', '/3d-director/', '/api/health/live', '/api/health/ready', '/canvas/project')) {
            $status = (Invoke-Native -Command curl.exe -Arguments @('-L', '-sS', '--max-time', '20', '-o', 'NUL', '-w', '%{http_code}', "$PublicUrl$path") | Out-String).Trim()
            if ($status -ne '200') {
                throw "External health check failed: $path returned $status"
            }
            Write-Output "$path=$status"
        }
        Write-Output "Deployment preflight completed: $targetSha"
        return
    }

    Invoke-Native git bundle create $bundlePath main
    Invoke-Native git bundle verify $bundlePath
    Invoke-Native scp.exe -F $sshConfig $bundlePath $helperPath "shoumiren-production:/tmp/"
    Invoke-Native ssh.exe -F $sshConfig shoumiren-production "sh $remoteHelper $remoteBundle $targetSha $PublicUrl $HealthTimeoutSeconds"

    foreach ($path in @('/healthz', '/3d-director/', '/api/health/live', '/api/health/ready', '/canvas/project')) {
        $status = (Invoke-Native -Command curl.exe -Arguments @('-L', '-sS', '--max-time', '20', '-o', 'NUL', '-w', '%{http_code}', "$PublicUrl$path") | Out-String).Trim()
        if ($status -ne '200') {
            throw "External health check failed: $path returned $status"
        }
        Write-Output "$path=$status"
    }
    Write-Output "Deployment completed: $targetSha"
}
finally {
    if (Test-Path -LiteralPath $runDirectory) {
        $resolvedRunDirectory = [System.IO.Path]::GetFullPath($runDirectory)
        if ($resolvedRunDirectory.StartsWith($rootPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
            Remove-Item -LiteralPath $resolvedRunDirectory -Recurse -Force
        }
    }
}
