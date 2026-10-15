<#
.SYNOPSIS
  Event Master frame test kit. Guided, read-only test of what the frame pushes.

.DESCRIPTION
  Checks the Windows side (network profile, firewall, node), then runs kit.js.
  The kit never changes the frame: you make every change in EMT when prompted.

  Run from an ADMIN PowerShell (needed to set the network profile and for the pktmon capture):
    powershell -ExecutionPolicy Bypass -File .\Run-FrameTests.ps1

  Rehearse against the mock frame first (no frame needed; you press Enter and the mock acts):
    powershell -ExecutionPolicy Bypass -File .\Run-FrameTests.ps1 -Rehearsal

.EXAMPLE
  .\Run-FrameTests.ps1 -Phases A -Steps A2,A3      # rerun just two steps
  .\Run-FrameTests.ps1 -Phases C                   # rerun just the EMT capture
#>
param(
    [string]$FrameIp = '192.168.0.175',
    [string]$LocalIp = '192.168.0.100',
    [int]$Port = 3000,
    [string]$Phases = 'id,preflight,prep,naming,ready,A,C',
    [string]$Steps = '',
    [double]$Settle = 3,
    [string]$OperatorId = '',
    [string]$Password = '',
    [string]$OutDir = '',
    [switch]$Rehearsal,
    [switch]$Auto
)

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $OutDir) { $OutDir = Join-Path $here 'results' }
$notes = New-Object System.Collections.ArrayList
function Note($level, $msg) {
    [void]$notes.Add("$level $msg")
    $colour = @{ 'OK' = 'Green'; 'WARN' = 'Yellow'; 'FAIL' = 'Red'; 'INFO' = 'Gray' }[$level]
    Write-Host ("  {0,-5} {1}" -f $level, $msg) -ForegroundColor $colour
}
function Confirm-YesNo($q, $default) {
    if ($Auto) { return $default }
    $suffix = '[y/N]'
    if ($default) { $suffix = '[Y/n]' }
    $a = Read-Host "  $q $suffix"
    if (-not $a) { return $default }
    return ($a.Trim().ToLower() -eq 'y')
}

Write-Host ''
Write-Host '== Windows checks ==' -ForegroundColor Cyan

# ---- node: Companion's bundled runtime, so nothing to install ----
$node = $null
# Newest bundled runtime first; kit.js itself only needs Node 18
foreach ($c in @(
        "$env:ProgramFiles\Companion\resources\node-runtimes\node26\node.exe",
        "$env:ProgramFiles\Companion\resources\node-runtimes\node22\node.exe",
        "$env:ProgramFiles\Companion\resources\node-runtimes\node18\node.exe")) {
    if (Test-Path $c) { $node = $c; break }
}
if (-not $node) {
    $cmd = Get-Command node -ErrorAction SilentlyContinue
    if ($cmd) { $node = $cmd.Source }
}
if (-not $node) {
    Note 'FAIL' 'No node.exe found (looked for Companion''s bundled runtime and node on PATH).'
    exit 1
}
Note 'OK' "node: $node ($(& $node --version))"

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator)
if ($isAdmin) { Note 'OK' 'Running as Administrator' }
else { Note 'WARN' 'Not Administrator: cannot change the network profile or run the pktmon capture (Phase C).' }

$mock = $null
$profileChanged = $null
try {
    if ($Rehearsal) {
        $FrameIp = '127.0.0.1'
        $LocalIp = '127.0.0.1'
        # A mock left behind by an interrupted rehearsal would hold 9999/9876
        Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue |
            Where-Object { $_.CommandLine -like '*mock-frame.js*' } |
            ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
        $mockArgs = @("`"$here\mock-frame.js`"", '--notify', '92', '--xml', 'push')
        $mock = Start-Process -FilePath $node -ArgumentList $mockArgs -PassThru -WindowStyle Hidden
        Start-Sleep -Milliseconds 800
        if ($mock.HasExited) { Note 'FAIL' 'Mock frame did not start (port 9999 or 9876 in use?)'; exit 1 }
        Note 'INFO' 'REHEARSAL: mock frame on 127.0.0.1 (behaves like EM 9.2, pushes XML on 9876).'
    }
    else {
        # ---- interface on the frame's subnet, and its network profile ----
        $prefix = ($FrameIp.Split('.')[0..2] -join '.') + '.'
        $ips = @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -like "$prefix*" })
        if ($ips.Count -eq 0) {
            Note 'FAIL' "No network interface on $($prefix)x. Check the cable and the laptop's IP (expected $LocalIp)."
        }
        else {
            $ip = $ips | Where-Object { $_.IPAddress -eq $LocalIp } | Select-Object -First 1
            if (-not $ip) {
                $ip = $ips[0]
                Note 'WARN' "$LocalIp is not on this PC. Using $($ip.IPAddress) ($($ip.InterfaceAlias)) instead."
                $LocalIp = $ip.IPAddress
            }
            else { Note 'OK' "$LocalIp on $($ip.InterfaceAlias)" }
            $prof = Get-NetConnectionProfile -InterfaceIndex $ip.InterfaceIndex -ErrorAction SilentlyContinue
            if ($prof) {
                if ($prof.NetworkCategory -eq 'Public') {
                    Note 'WARN' "Network '$($prof.Name)' on $($ip.InterfaceAlias) is Public: inbound notifications may be blocked."
                    if ($isAdmin -and (Confirm-YesNo "Set '$($prof.Name)' to Private for the test?" $true)) {
                        Set-NetConnectionProfile -InterfaceIndex $ip.InterfaceIndex -NetworkCategory Private
                        $profileChanged = @{ Index = $ip.InterfaceIndex; Name = $prof.Name }
                        Note 'OK' "Set '$($prof.Name)' to Private (will offer to revert at the end)"
                    }
                    elseif (-not $isAdmin) { Note 'WARN' 'Rerun from an admin PowerShell to change it.' }
                }
                else { Note 'OK' "Network '$($prof.Name)' is $($prof.NetworkCategory)" }
            }
        }

        # ---- firewall: an inbound allow rule for the port, and no block rule on node.exe ----
        $category = 'Private'
        if ($prof -and -not $profileChanged) { $category = [string]$prof.NetworkCategory }
        if (-not $isAdmin) {
            # Port and program filters can't be read without admin: list likely rules by name instead
            $named = @(Get-NetFirewallRule -ErrorAction SilentlyContinue |
                    Where-Object { $_.Enabled -eq 'True' -and $_.Direction -eq 'Inbound' -and
                        $_.DisplayName -match 'Companion|eventmaster|Event Master|EM notif' })
            foreach ($r in $named) { Note 'INFO' "Inbound rule '$($r.DisplayName)': $($r.Action), profile $($r.Profile)" }
            Note 'INFO' "Can't verify which rule covers TCP $Port without admin. Control step A1 will prove it either way."
        }
        $rules = @(Get-NetFirewallPortFilter -Protocol TCP -ErrorAction SilentlyContinue |
                Where-Object { $_.LocalPort -eq [string]$Port } |
                Get-NetFirewallRule -ErrorAction SilentlyContinue |
                Where-Object { $_.Enabled -eq 'True' -and $_.Direction -eq 'Inbound' -and $_.Action -eq 'Allow' })
        $covering = @($rules | Where-Object { $_.Profile -eq 'Any' -or ([string]$_.Profile) -match $category })
        if (-not $isAdmin) { }
        elseif ($covering.Count -gt 0) {
            Note 'OK' "Inbound allow rule for TCP $Port`: $($covering[0].DisplayName) (profile $($covering[0].Profile))"
        }
        elseif ($rules.Count -gt 0) {
            Note 'WARN' "Inbound rule for TCP $Port exists ($($rules[0].DisplayName)) but its profile ($($rules[0].Profile)) does not cover $category."
        }
        else {
            Note 'WARN' "No enabled inbound allow rule for TCP $Port."
            if ($isAdmin -and (Confirm-YesNo "Add one (Event Master notifications TCP $Port, any profile)?" $true)) {
                New-NetFirewallRule -DisplayName "Event Master notifications TCP $Port" -Direction Inbound `
                    -Protocol TCP -LocalPort $Port -Action Allow -Profile Any | Out-Null
                Note 'OK' "Added inbound rule for TCP $Port (left in place: Companion live updates need it)"
            }
        }
        $blocks = @(Get-NetFirewallApplicationFilter -ErrorAction SilentlyContinue |
                Where-Object { $_.Program -like '*node*.exe' } |
                Get-NetFirewallRule -ErrorAction SilentlyContinue |
                Where-Object { $_.Enabled -eq 'True' -and $_.Direction -eq 'Inbound' -and $_.Action -eq 'Block' })
        foreach ($b in $blocks) {
            $prog = ($b | Get-NetFirewallApplicationFilter).Program
            Note 'WARN' "Inbound BLOCK rule '$($b.DisplayName)' for $prog (profile $($b.Profile)). Block beats allow: disable it if notifications don't arrive."
        }

        # ---- Companion must not be holding the port ----
        $busy = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
        if ($busy) {
            $p = Get-Process -Id $busy[0].OwningProcess -ErrorAction SilentlyContinue
            Note 'FAIL' "TCP $Port is in use by $($p.ProcessName) (pid $($busy[0].OwningProcess)). Disable the Companion Event Master connection."
        }
        else { Note 'OK' "TCP $Port is free" }
    }

    Write-Host ''
    Write-Host '  Before continuing: DISABLE the Event Master connection in Companion, and have EMT connected.' -ForegroundColor Yellow

    $notesFile = Join-Path $env:TEMP 'frame-test-kit-notes.json'
    ConvertTo-Json -InputObject @($notes) | Set-Content -Path $notesFile -Encoding UTF8

    $kitArgs = @("$here\kit.js", '--frame', $FrameIp, '--local', $LocalIp, '--port', $Port, '--phases', $Phases,
        '--settle', $Settle, '--out', $OutDir, '--wrapper-notes', $notesFile)
    if ($Steps) { $kitArgs += @('--steps', $Steps) }
    if ($OperatorId) { $kitArgs += @('--operator-id', $OperatorId) }
    if ($Password) { $kitArgs += @('--password', $Password) }
    if ($Rehearsal) { $kitArgs += @('--mock-control', 'http://127.0.0.1:9999/_mock/do', '--no-pktmon') }
    if ($Auto) { $kitArgs += '--auto' }
    & $node @kitArgs
    $kitExit = $LASTEXITCODE
}
finally {
    if ($mock -and -not $mock.HasExited) { Stop-Process -Id $mock.Id -Force -ErrorAction SilentlyContinue }
    if ($profileChanged) {
        if (Confirm-YesNo "Put network '$($profileChanged.Name)' back to Public?" $false) {
            Set-NetConnectionProfile -InterfaceIndex $profileChanged.Index -NetworkCategory Public
            Write-Host "  Reverted '$($profileChanged.Name)' to Public."
        }
        else { Write-Host "  Left '$($profileChanged.Name)' as Private." }
    }
}
exit $kitExit
