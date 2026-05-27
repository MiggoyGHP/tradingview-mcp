# launch-tradingview.ps1
# Launches TradingView Desktop with CDP enabled (port 9222).
# Works for both Windows Store (AppX) and classic installer builds.
# Run from any terminal: .\launch-tradingview.ps1

$CDP_PORT = 9222

Write-Host "Stopping any running TradingView processes..." -ForegroundColor Cyan
Get-Process -Name "TradingView" -ErrorAction SilentlyContinue | Stop-Process -Force -Confirm:$false
Start-Sleep -Milliseconds 1500

# Detect install type: Windows Store (AppX) vs classic installer
$aumid = $null
try {
    $aumid = (Get-StartApps | Where-Object { $_.Name -like '*TradingView*' } | Select-Object -First 1).AppID
} catch {}

if ($aumid) {
    Write-Host "Detected Windows Store install. Launching via COM activation..." -ForegroundColor Cyan
    Write-Host "  AUMID: $aumid" -ForegroundColor DarkGray

    Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class TvLauncher {
    [DllImport("ole32.dll", PreserveSig = false)]
    static extern void CoCreateInstance(ref Guid rclsid, IntPtr pUnkOuter, uint dwClsContext, ref Guid riid, out IntPtr ppv);
    [ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("2e941141-7f97-4756-ba1d-9decde894a3d")]
    interface IApplicationActivationManager {
        int ActivateApplication([MarshalAs(UnmanagedType.LPWStr)] string appUserModelId, [MarshalAs(UnmanagedType.LPWStr)] string arguments, int options, out uint processId);
    }
    public static uint Launch(string aumid, string args) {
        var clsid = new Guid("45BA127D-10A8-46EA-8AB7-56EA9078943C");
        var iid   = new Guid("2e941141-7f97-4756-ba1d-9decde894a3d");
        IntPtr ppv; CoCreateInstance(ref clsid, IntPtr.Zero, 1, ref iid, out ppv);
        var mgr = (IApplicationActivationManager)Marshal.GetObjectForIUnknown(ppv);
        uint pid; mgr.ActivateApplication(aumid, args, 0, out pid);
        Marshal.Release(ppv); return pid;
    }
}
'@
    $pid = [TvLauncher]::Launch($aumid, "--remote-debugging-port=$CDP_PORT")
    Write-Host "  Launched PID: $pid" -ForegroundColor DarkGray

} else {
    # Classic installer — find exe and spawn directly
    $classicPaths = @(
        "$env:LOCALAPPDATA\TradingView\TradingView.exe",
        "$env:PROGRAMFILES\TradingView\TradingView.exe",
        "${env:PROGRAMFILES(X86)}\TradingView\TradingView.exe"
    )
    $tvExe = $classicPaths | Where-Object { Test-Path $_ } | Select-Object -First 1
    if (-not $tvExe) {
        Write-Host "ERROR: TradingView not found. Install it from https://www.tradingview.com/desktop/" -ForegroundColor Red
        exit 1
    }
    Write-Host "Detected classic install. Launching: $tvExe" -ForegroundColor Cyan
    Start-Process -FilePath $tvExe -ArgumentList "--remote-debugging-port=$CDP_PORT"
}

# Poll CDP until ready (up to 30 seconds)
Write-Host "Waiting for CDP on port $CDP_PORT..." -ForegroundColor Cyan
$ready = $false
for ($i = 1; $i -le 30; $i++) {
    Start-Sleep -Seconds 1
    try {
        $resp = Invoke-WebRequest -Uri "http://localhost:$CDP_PORT/json/version" -UseBasicParsing -TimeoutSec 1 -ErrorAction Stop
        $info = $resp.Content | ConvertFrom-Json
        Write-Host ""
        Write-Host "SUCCESS: TradingView CDP is ready!" -ForegroundColor Green
        Write-Host "  Browser : $($info.Browser)" -ForegroundColor Green
        Write-Host "  CDP URL : http://localhost:$CDP_PORT" -ForegroundColor Green
        $ready = $true
        break
    } catch {
        Write-Host -NoNewline "."
    }
}

if (-not $ready) {
    Write-Host ""
    Write-Host "WARNING: CDP did not respond within 30s. TradingView may still be loading." -ForegroundColor Yellow
    Write-Host "  Run tv_health_check in Claude to retry the connection." -ForegroundColor Yellow
}
