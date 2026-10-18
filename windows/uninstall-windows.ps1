# Stops the server and removes the tasks and shortcut. Leaves your data folder alone.
$AppDir = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$node = Join-Path $env:ProgramFiles 'nodejs\node.exe'
if (-not (Test-Path $node)) { $node = 'node' }
& $node (Join-Path $AppDir 'scripts\stop.js')
foreach ($name in 'Seed & Harvest - Start Morning', 'Seed & Harvest - Stop 9 PM') {
  if (Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue) { Unregister-ScheduledTask -TaskName $name -Confirm:$false }
}
$lnk = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Seed & Harvest Dashboard.lnk'
if (Test-Path $lnk) { Remove-Item $lnk }
Write-Host 'Removed the scheduled tasks and the Desktop shortcut. Your data folder was not touched.'
