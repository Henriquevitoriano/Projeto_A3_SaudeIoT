$repo = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $repo

$ports = 1883,8080,8081,8082,8083,8084,8090
$connections = Get-NetTCPConnection -LocalPort $ports -State Listen -ErrorAction SilentlyContinue
if ($connections) {
    $pidsLocal = $connections | Select-Object -ExpandProperty OwningProcess | Sort-Object -Unique
    if ($pidsLocal) {
        Write-Host "Stopping existing service PIDs: $($pidsLocal -join ', ')"
        foreach ($p in $pidsLocal) {
            Stop-Process -Id $p -Force -ErrorAction SilentlyContinue
        }
        Start-Sleep -Seconds 2
    }
}

Write-Host "Starting services..."
New-Item -ItemType Directory -Path (Join-Path $repo '.logs') -Force | Out-Null
$services = @(
    @{ Name = 'mqtt-broker'; Path = 'Back End\mqtt-broker'; Args = @('start') },
    @{ Name = 'audit-service'; Path = 'Back End\audit-service'; Args = @('start') },
    @{ Name = 'patients-service'; Path = 'Back End\patients-service'; Args = @('start') },
    @{ Name = 'query-service'; Path = 'Back End\query-service'; Args = @('start') },
    @{ Name = 'alerts-service'; Path = 'Back End\alerts-service'; Args = @('start') },
    @{ Name = 'ingestion-service'; Path = 'Back End\ingestion-service'; Args = @('start') }
)

foreach ($svc in $services) {
    $logPath = Join-Path $repo ".logs\$($svc.Name).log"
    $errLogPath = Join-Path $repo ".logs\$($svc.Name)-err.log"
    Write-Host "Starting $($svc.Name)... (log -> $logPath)"
    Start-Process -FilePath npm.cmd -ArgumentList $svc.Args -WorkingDirectory (Join-Path $repo $svc.Path) -WindowStyle Hidden -RedirectStandardOutput $logPath -RedirectStandardError $errLogPath
}

Write-Host "Starting api-gateway..."
$logPath = Join-Path $repo '.logs\api-gateway.log'
$errLogPath = Join-Path $repo '.logs\api-gateway-err.log'
Start-Process -FilePath npm.cmd -ArgumentList @('start') -WorkingDirectory (Join-Path $repo 'Back End\api-gateway') -WindowStyle Hidden -RedirectStandardOutput $logPath -RedirectStandardError $errLogPath

Write-Host "Starting dashboard..."
$logPath = Join-Path $repo '.logs\dashboard.log'
$errLogPath = Join-Path $repo '.logs\dashboard-err.log'
Start-Process -FilePath npm.cmd -ArgumentList @('run', 'dev') -WorkingDirectory (Join-Path $repo 'Front End\dashboard') -WindowStyle Hidden -RedirectStandardOutput $logPath -RedirectStandardError $errLogPath

Start-Sleep -Seconds 5
Write-Host "Service port status:"
Get-NetTCPConnection -LocalPort $ports -State Listen -ErrorAction SilentlyContinue | Select-Object LocalAddress,LocalPort,OwningProcess | Sort-Object LocalPort | Format-Table -AutoSize
