/// <reference types="vite/client" />

import type {
  AiConfig,
  AiSummarizeResult,
  AiTestResult,
  AppConfig,
  AppendSummaryInput,
  AppendSummaryResult,
  BackupHistoryItem,
  BackupRunResult,
  ManualSummaryHistoryItem,
  ManualSummaryInput,
  ManualSummaryProgressEvent,
  ManualSummaryResult,
  QceGroup,
  QceHealth,
  QceDiagnosis,
  QceUpdateCheckResult,
  QceUpdateResult,
  AppRunStatus,
  BackupProgressEvent
} from '../../main/types';

type Unsubscribe = () => void;

declare global {
  interface Window {
    qceAiBackup: {
      config: {
        get(): Promise<AppConfig>;
        update(patch: Partial<AppConfig>): Promise<AppConfig>;
      };
      qce: {
        validatePath(qceDir: string): Promise<{ ok: boolean; message: string }>;
        start(): Promise<void>;
        stop(): Promise<void>;
        checkUpdate(): Promise<QceUpdateCheckResult>;
        update(): Promise<QceUpdateResult>;
        health(): Promise<QceHealth>;
        diagnose(): Promise<QceDiagnosis>;
        readTokenPreview(): Promise<{ ok: boolean; tokenPreview?: string; error?: string }>;
        listGroups(): Promise<QceGroup[]>;
        openWebUi(): Promise<void>;
      };
      backup: {
        runPlan(planId: string): Promise<BackupRunResult>;
        runStartupBackfill(planId: string): Promise<BackupRunResult[]>;
        testExport(planId: string): Promise<BackupRunResult>;
        listHistory(): Promise<BackupHistoryItem[]>;
      };
      ai: {
        testConnection(providerId?: string, config?: Partial<AiConfig>): Promise<AiTestResult>;
        testSummaryWithText(text: string): Promise<AiSummarizeResult>;
      };
      summary: {
        runManual(input: ManualSummaryInput): Promise<ManualSummaryResult>;
        listManualHistory(): Promise<ManualSummaryHistoryItem[]>;
        onManualProgress(callback: (event: ManualSummaryProgressEvent) => void): Unsubscribe;
      };
      markdown: {
        testWrite(input: AppendSummaryInput): Promise<AppendSummaryResult>;
        openFile(path: string): Promise<void>;
        openDir(path: string): Promise<void>;
      };
      autoLaunch: {
        getStatus(): Promise<{ enabled: boolean }>;
        enable(): Promise<void>;
        disable(): Promise<void>;
      };
      logs: {
        getRecent(): Promise<string[]>;
        clear(): Promise<void>;
        openDir(): Promise<void>;
        onLine(callback: (line: string) => void): Unsubscribe;
      };
      events: {
        onAppStatus(callback: (status: AppRunStatus) => void): Unsubscribe;
        onQceOutput(callback: (line: string) => void): Unsubscribe;
        onBackupProgress(callback: (event: BackupProgressEvent) => void): Unsubscribe;
      };
    };
  }
}
