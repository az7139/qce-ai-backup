import type { AppRunStatus } from './backup';

export type BackupHistoryItem = {
  id: string;
  planId: string;
  planName: string;
  groupCode: string;
  groupName?: string;
  windowKey: string;
  startAt: string;
  endAt: string;
  trigger: 'manual' | 'startup' | 'schedule';
  status: AppRunStatus;
  exportStatus?: AppRunStatus;
  summaryStatus?: AppRunStatus;
  markdownStatus?: AppRunStatus;
  exportFilePath?: string;
  markdownPath?: string;
  error?: string;
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
};
