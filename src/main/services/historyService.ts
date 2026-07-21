import { app } from 'electron';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, normalize, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { BackupHistoryItem } from '../types/history';

export class HistoryService {
  private readonly filePath: string;

  constructor() {
    const dir = join(app.getPath('appData'), 'QCE AI Backup');
    mkdirSync(dir, { recursive: true });
    this.filePath = join(dir, 'history.json');
  }

  list(): BackupHistoryItem[] {
    if (!existsSync(this.filePath)) return [];
    try {
      return JSON.parse(readFileSync(this.filePath, 'utf8')) as BackupHistoryItem[];
    } catch {
      return [];
    }
  }

  findByWindowKey(windowKey: string, expected?: { exportDir?: string; markdownPath?: string }): BackupHistoryItem | undefined {
    return this.list().find((item) => {
      if (item.windowKey !== windowKey || item.status !== 'success') return false;
      if (!item.exportFilePath || !existsSync(item.exportFilePath)) return false;
      if (!item.markdownPath || !existsSync(item.markdownPath)) return false;
      if (expected?.exportDir && !isSameOrChildPath(item.exportFilePath, expected.exportDir)) return false;
      if (expected?.markdownPath && !isSamePath(item.markdownPath, expected.markdownPath)) return false;
      return true;
    });
  }

  findExportByWindowKey(windowKey: string, expected?: { exportDir?: string }): BackupHistoryItem | undefined {
    return this.list().find((item) => {
      if (item.windowKey !== windowKey) return false;
      if (!['export_success', 'success'].includes(item.status)) return false;
      if (!item.exportFilePath || !existsSync(item.exportFilePath)) return false;
      if (expected?.exportDir && !isSameOrChildPath(item.exportFilePath, expected.exportDir)) return false;
      return true;
    });
  }

  findSummaryByWindowKey(windowKey: string, expected?: { markdownPath?: string }): BackupHistoryItem | undefined {
    return this.list().find((item) => {
      if (item.windowKey !== windowKey || item.status !== 'success') return false;
      if (!item.markdownPath || !existsSync(item.markdownPath)) return false;
      if (expected?.markdownPath && !isSamePath(item.markdownPath, expected.markdownPath)) return false;
      return true;
    });
  }

  upsert(item: Omit<BackupHistoryItem, 'id'> & { id?: string }): BackupHistoryItem {
    const list = this.list();
    const existingIndex = item.id ? list.findIndex((current) => current.id === item.id) : -1;
    const next: BackupHistoryItem = { ...item, id: item.id ?? randomUUID() };
    if (existingIndex >= 0) list[existingIndex] = next;
    else list.unshift(next);
    writeFileSync(this.filePath, JSON.stringify(list.slice(0, 1000), null, 2), 'utf8');
    return next;
  }
}

function isSamePath(left: string, right: string): boolean {
  return normalize(resolve(left)).toLowerCase() === normalize(resolve(right)).toLowerCase();
}

function isSameOrChildPath(filePath: string, dirPath: string): boolean {
  const fileDir = normalize(resolve(dirname(filePath))).toLowerCase();
  const dir = normalize(resolve(dirPath)).replace(/[\\/]+$/, '').toLowerCase();
  return fileDir === dir || fileDir.startsWith(`${dir}\\`) || fileDir.startsWith(`${dir}/`);
}
