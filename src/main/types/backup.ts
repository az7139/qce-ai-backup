export type AppRunStatus =
  | 'idle'
  | 'qce_starting'
  | 'waiting_login'
  | 'qce_online'
  | 'exporting'
  | 'export_success'
  | 'parsing'
  | 'summarizing'
  | 'writing_markdown'
  | 'success'
  | 'cleanup'
  | 'done'
  | 'failed';

export type BackupWindow = {
  startAt: string;
  endAt: string;
  startUnix: number;
  endUnix: number;
  windowKey: string;
};

export type BackupProgressEvent = {
  planId: string;
  status: AppRunStatus;
  message: string;
  at: string;
};

export type BackupRunResult = {
  ok: boolean;
  status: AppRunStatus;
  planId: string;
  windowKey?: string;
  exportFilePath?: string;
  exportFilePaths?: string[];
  markdownPath?: string;
  error?: string;
};

export type ChatMessage = {
  time?: string;
  sender?: string;
  senderId?: string;
  type?: string;
  content: string;
  raw?: unknown;
};
