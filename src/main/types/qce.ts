import type { ExportFormat } from './config';

export type QceHealth = {
  ok: boolean;
  online: boolean;
  status?: string;
  raw?: unknown;
  error?: string;
};

export type QceDiagnosisItem = {
  name: string;
  ok: boolean;
  detail: string;
};

export type QceDiagnosis = {
  ok: boolean;
  items: QceDiagnosisItem[];
  hints: string[];
};

export type QceGroup = {
  groupCode: string;
  groupName: string;
  memberCount?: number;
  raw?: unknown;
};

export type QceUpdateResult = {
  ok: boolean;
  message: string;
  error?: string;
  version?: string;
  qceDir?: string;
  previousQceDir?: string;
  alreadyLatest?: boolean;
};

export type QceUpdateCheckResult = {
  ok: boolean;
  updateAvailable: boolean;
  message: string;
  currentVersion?: string;
  latestVersion?: string;
  error?: string;
};

export type CreateExportTaskInput = {
  peer: {
    chatType: 2;
    peerUid: string;
    guildId: '';
  };
  sessionName: string;
  format: ExportFormat;
  filter: {
    startTime?: number;
    endTime?: number;
    keywords?: string[];
    excludeUserUins?: string[];
    includeUserUins?: string[];
    includeRecalled?: boolean;
  };
  options: {
    batchSize?: number;
    includeResourceLinks?: boolean;
    includeSystemMessages?: boolean;
    filterPureImageMessages?: boolean;
    prettyFormat?: boolean;
    exportAsZip?: boolean;
    preferGroupMemberName?: boolean;
    outputDir?: string;
    useNameInFileName?: boolean;
    useFriendlyFileName?: boolean;
    skipDownloadResourceTypes?: string[];
  };
};

export type CreateExportTaskResult = {
  taskId: string;
  downloadUrl?: string;
  filePath?: string;
  raw: unknown;
};

export type QceTask = {
  taskId: string;
  status: 'pending' | 'running' | 'success' | 'failed' | 'unknown';
  progress?: number;
  downloadUrl?: string;
  filePath?: string;
  error?: string;
  raw: unknown;
};
