import { app } from 'electron';
import { execFileSync } from 'node:child_process';

export class AutoLaunchService {
  getStatus(): { enabled: boolean } {
    const exact = app.getLoginItemSettings(this.loginItemIdentity());
    const fallback = app.getLoginItemSettings();
    return { enabled: exact.openAtLogin || fallback.openAtLogin || this.hasWindowsRunKey() };
  }

  enable(): void {
    app.setLoginItemSettings({
      ...this.loginItemIdentity(),
      openAtLogin: true
    });
    this.writeWindowsRunKey();
  }

  disable(): void {
    app.setLoginItemSettings({
      ...this.loginItemIdentity(),
      openAtLogin: false
    });
    this.deleteWindowsRunKey();
  }

  private loginItemIdentity() {
    return {
      name: 'QCE AI Backup',
      path: process.execPath,
      args: ['--startup', '--hidden', '--run-due']
    };
  }

  private hasWindowsRunKey(): boolean {
    if (process.platform !== 'win32') return false;
    try {
      execFileSync('reg.exe', ['query', RUN_KEY, '/v', RUN_VALUE_NAME], { encoding: 'utf8', windowsHide: true });
      return true;
    } catch {
      return false;
    }
  }

  private writeWindowsRunKey(): void {
    if (process.platform !== 'win32') return;
    const command = `"${process.execPath}" --startup --hidden --run-due`;
    execFileSync('reg.exe', ['add', RUN_KEY, '/v', RUN_VALUE_NAME, '/t', 'REG_SZ', '/d', command, '/f'], {
      windowsHide: true
    });
  }

  private deleteWindowsRunKey(): void {
    if (process.platform !== 'win32') return;
    try {
      execFileSync('reg.exe', ['delete', RUN_KEY, '/v', RUN_VALUE_NAME, '/f'], { windowsHide: true });
    } catch {
      // The value may already have been removed by Electron.
    }
  }
}

const RUN_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
const RUN_VALUE_NAME = 'QCE AI Backup';
