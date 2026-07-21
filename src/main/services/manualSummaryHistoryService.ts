import { app } from 'electron';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ManualSummaryHistoryItem } from '../types/summary';

export class ManualSummaryHistoryService {
  private readonly filePath: string;

  constructor() {
    const dir = join(app.getPath('appData'), 'QCE AI Backup');
    mkdirSync(dir, { recursive: true });
    this.filePath = join(dir, 'manual-summary-history.json');
  }

  list(): ManualSummaryHistoryItem[] {
    if (!existsSync(this.filePath)) return [];
    try {
      return JSON.parse(readFileSync(this.filePath, 'utf8')) as ManualSummaryHistoryItem[];
    } catch {
      return [];
    }
  }

  upsert(item: Omit<ManualSummaryHistoryItem, 'id'> & { id?: string }): ManualSummaryHistoryItem {
    const list = this.list();
    const existingIndex = item.id ? list.findIndex((current) => current.id === item.id) : -1;
    const next: ManualSummaryHistoryItem = { ...item, id: item.id ?? randomUUID() };
    if (existingIndex >= 0) list[existingIndex] = next;
    else list.unshift(next);
    writeFileSync(this.filePath, JSON.stringify(list.slice(0, 1000), null, 2), 'utf8');
    return next;
  }
}
