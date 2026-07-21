export type AppendSummaryInput = {
  markdownPath: string;
  duplicatePolicy: 'skipIfWindowExists' | 'replaceSameWindow' | 'appendAnyway';
  windowKey: string;
  title: string;
  metadata: Record<string, string | number | boolean>;
  summaryMarkdown: string;
};

export type AppendSummaryResult = {
  written: boolean;
  skipped: boolean;
  path: string;
  marker: string;
};

export type ManualSummaryInput = {
  sourceHistoryId?: string;
  exportFilePath: string;
  markdownPath: string;
  groupName?: string;
  groupCode?: string;
  startAt?: string;
  endAt?: string;
  duplicatePolicy?: 'skipIfWindowExists' | 'replaceSameWindow' | 'appendAnyway';
};

export type ManualSummaryHistoryItem = {
  id: string;
  sourceHistoryId?: string;
  exportFilePath: string;
  groupName: string;
  groupCode?: string;
  startAt: string;
  endAt: string;
  markdownPath: string;
  status: 'success' | 'failed';
  messageCount?: number;
  error?: string;
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
};

export type ManualSummaryResult = {
  ok: boolean;
  historyItem?: ManualSummaryHistoryItem;
  markdownPath?: string;
  error?: string;
};

export type ManualSummaryProgressEvent = {
  runId: string;
  level: 'info' | 'warn' | 'error' | 'success';
  step: string;
  message: string;
  at: string;
};
