import { EventEmitter } from 'node:events';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import type { QceConfig } from '../types/config';
import { LogService } from './logService';
import { killProcessTree } from './processKillService';
import { applyQceHistoryPaginationPatch } from './qceCompatibilityPatch';

export class QceProcessService extends EventEmitter {
  private child?: ChildProcessWithoutNullStreams;
  private ownedPid?: number;
  private processSessionId = 0;

  constructor(private readonly logs: LogService) {
    super();
  }

  get pid(): number | undefined {
    return this.ownedPid;
  }

  get sessionId(): number {
    return this.processSessionId;
  }

  get running(): boolean {
    return Boolean(this.child && !this.child.killed);
  }

  start(config: QceConfig): void {
    if (this.running) return;
    if (!config.qceDir) throw new Error('QCE Shell 目录为空');
    if (!config.launcherBat || !existsSync(config.launcherBat)) {
      throw new Error('launcher-user.bat 不存在');
    }

    const quickLoginUin = config.quickLoginUin?.trim();
    applyQceHistoryPaginationPatch(config.qceDir, this.logs);
    this.logs.info('qce', `启动 QCE：${config.launcherBat}${quickLoginUin ? ' quickLogin=已配置' : ''}`);
    const child = spawn('cmd.exe', ['/c', config.launcherBat, ...(quickLoginUin ? [quickLoginUin] : [])], {
      cwd: config.qceDir,
      windowsHide: !config.showQceConsole,
      env: {
        ...process.env,
        ...(quickLoginUin ? { QCE_QUICK_LOGIN_UIN: quickLoginUin } : {})
      }
    });
    this.child = child;
    this.ownedPid = child.pid;
    this.processSessionId += 1;

    child.stdout.on('data', (data) => this.pushOutput(String(data)));
    child.stderr.on('data', (data) => this.pushOutput(String(data)));
    child.on('error', (error) => {
      this.logs.error('qce', `QCE 启动失败：${error.message}`);
      this.emit('error', error);
    });
    child.on('exit', (code, signal) => {
      this.logs.info('qce', `QCE 进程退出：code=${code ?? ''} signal=${signal ?? ''}`);
      this.emit('exit', { code, signal });
      if (this.child === child) {
        this.child = undefined;
        this.ownedPid = undefined;
      }
    });
  }

  async stop(force = true): Promise<void> {
    if (!this.ownedPid) return;
    const pid = this.ownedPid;
    this.logs.info('qce', `关闭 QCE 进程树：pid=${pid}`);
    try {
      await killProcessTree(pid, force);
    } finally {
      this.child = undefined;
      this.ownedPid = undefined;
    }
  }

  releaseForAppExit(): void {
    if (!this.child) return;
    this.logs.info('qce', `保留 QCE/NapCat 进程并释放应用持有的句柄：pid=${this.ownedPid ?? ''}`);
    this.child.stdout.removeAllListeners('data');
    this.child.stderr.removeAllListeners('data');
    this.child.removeAllListeners('exit');
    this.child.removeAllListeners('error');
    this.child.stdin.destroy();
    this.child.stdout.destroy();
    this.child.stderr.destroy();
    this.child.unref();
    this.child = undefined;
    this.ownedPid = undefined;
  }

  private pushOutput(output: string): void {
    this.emit('output', output);
    for (const line of stripAnsi(output).split(/\r?\n/).filter(Boolean)) {
      this.logs.info('qce', line);
    }
  }
}

function stripAnsi(value: string): string {
  return value.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '');
}
