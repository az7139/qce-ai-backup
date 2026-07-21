import { execFile } from 'node:child_process';

export function killProcessTree(pid: number, force = true): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = ['/PID', String(pid), '/T'];
    if (force) args.push('/F');
    execFile('taskkill', args, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

export function cleanupQceProcessTrees(qceDir: string, force = true): Promise<number[]> {
  return new Promise((resolve, reject) => {
    if (!qceDir.trim()) {
      resolve([]);
      return;
    }

    const script = `
$ErrorActionPreference = 'Stop'
$qceDir = $env:QCE_CLEANUP_QCE_DIR
if ([string]::IsNullOrWhiteSpace($qceDir)) {
  Write-Output '[]'
  exit 0
}
try {
  $resolved = (Resolve-Path -LiteralPath $qceDir).Path
} catch {
  $resolved = $qceDir
}
$alt = $resolved -replace '\\\\','/'
$all = Get-CimInstance Win32_Process
$targets = New-Object 'System.Collections.Generic.List[int]'
foreach ($p in $all) {
  $cmd = [string]$p.CommandLine
  if ([string]::IsNullOrWhiteSpace($cmd)) { continue }
  if ($cmd.IndexOf($resolved, [System.StringComparison]::OrdinalIgnoreCase) -lt 0 -and $cmd.IndexOf($alt, [System.StringComparison]::OrdinalIgnoreCase) -lt 0) { continue }
  if ($p.ProcessId -eq $PID) { continue }
  $targets.Add([int]$p.ProcessId)
}
$killed = New-Object 'System.Collections.Generic.List[int]'
foreach ($pidToKill in ($targets | Sort-Object -Unique)) {
  $args = @('/PID', [string]$pidToKill, '/T')
  if ($env:QCE_CLEANUP_FORCE -eq '1') { $args += '/F' }
  & taskkill @args *> $null
  if ($LASTEXITCODE -eq 0) { $killed.Add([int]$pidToKill) }
}
$killed | ConvertTo-Json -Compress
`;

    execFile(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script],
      {
        env: {
          ...process.env,
          QCE_CLEANUP_QCE_DIR: qceDir,
          QCE_CLEANUP_FORCE: force ? '1' : '0'
        }
      },
      (error, stdout) => {
        if (error) {
          reject(error);
          return;
        }
        try {
          const parsed = JSON.parse(stdout.trim() || '[]') as number[] | number;
          resolve(Array.isArray(parsed) ? parsed : [parsed]);
        } catch {
          resolve([]);
        }
      }
    );
  });
}
