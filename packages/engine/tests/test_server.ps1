$proc = Start-Process -FilePath "node_modules\.bin\tsx.cmd" -ArgumentList "src/index.ts", "--serve" -PassThru -NoNewWindow
Start-Sleep -Seconds 5
try {
    $response = Invoke-RestMethod -Uri "http://localhost:4000/api/health" -Method POST
    Write-Host "Success! Server responded to POST:"
    $response | ConvertTo-Json
} catch {
    Write-Host "Failed: $_"
} finally {
    Stop-Process -Id $proc.Id -Force
}
