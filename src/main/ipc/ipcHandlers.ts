import { BrowserWindow, ipcMain, shell } from 'electron';
import { dirname } from 'node:path';
import type { ConfigService } from '../services/configService';
import type { QceProcessService } from '../services/qceProcessService';
import type { QceUpdateService } from '../services/qceUpdateService';
import type { QceApiClient } from '../services/qceApiClient';
import type { BackupRunner } from '../services/backupRunner';
import type { AiClient } from '../services/aiClient';
import type { MarkdownAppendService } from '../services/markdownAppendService';
import type { AutoLaunchService } from '../services/autoLaunchService';
import type { LogService } from '../services/logService';
import type { HistoryService } from '../services/historyService';
import type { ManualSummaryHistoryService } from '../services/manualSummaryHistoryService';
import type { SummaryService } from '../services/summaryService';
import type { AiConfig, AppendSummaryInput, BackupPlan, ManualSummaryInput, ManualSummaryProgressEvent } from '../types';

export type IpcServices = {
  config: ConfigService;
  qceProcess: QceProcessService;
  qceUpdater: QceUpdateService;
  qceApi: QceApiClient;
  backupRunner: BackupRunner;
  aiClient: AiClient;
  summary: SummaryService;
  markdown: MarkdownAppendService;
  autoLaunch: AutoLaunchService;
  logs: LogService;
  history: HistoryService;
  manualSummaryHistory: ManualSummaryHistoryService;
};

export function registerIpcHandlers(services: IpcServices): void {
  ipcMain.handle('config:get', () => services.config.get());
  ipcMain.handle('config:update', (_, patch) => services.config.update(patch));

  ipcMain.handle('qce:validatePath', (_, qceDir: string) => services.config.validateQcePath(qceDir));
  ipcMain.handle('qce:start', () => services.qceProcess.start(services.config.get().qce));
  ipcMain.handle('qce:stop', () => services.qceProcess.stop(true));
  ipcMain.handle('qce:checkUpdate', () => services.qceUpdater.checkLatest());
  ipcMain.handle('qce:update', () => services.qceUpdater.updateLatest());
  ipcMain.handle('qce:health', () => services.qceApi.health(services.config.get().qce));
  ipcMain.handle('qce:diagnose', () => services.qceApi.diagnose(services.config.get().qce));
  ipcMain.handle('qce:readTokenPreview', () => {
    try {
      const token = services.qceApi.readAccessToken(services.config.get().qce);
      return { ok: true, tokenPreview: `${token.slice(0, 4)}****${token.slice(-4)}` };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
  ipcMain.handle('qce:listGroups', () => services.qceApi.listGroups(services.config.get().qce));
  ipcMain.handle('qce:openWebUi', () => shell.openExternal(services.qceApi.webUiUrl(services.config.get().qce)));

  ipcMain.handle('backup:runPlan', (_, planId: string) => services.backupRunner.runPlan(planId, 'manual'));
  ipcMain.handle('backup:runStartupBackfill', (_, planId: string) => services.backupRunner.runStartupBackfill(planId, 'manual'));
  ipcMain.handle('backup:testExport', (_, planId: string) =>
    services.backupRunner.runPlan(planId, 'manual', { exportOnly: true, healthTimeoutSeconds: 12 })
  );
  ipcMain.handle('backup:listHistory', () => services.history.list());

  ipcMain.handle('summary:listManualHistory', () => services.manualSummaryHistory.list());
  ipcMain.handle('summary:runManual', async (event, input: ManualSummaryInput) => {
    const startedAt = new Date();
    const runId = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const sendProgress = (level: ManualSummaryProgressEvent['level'], step: string, message: string) => {
      event.sender.send('summary:manualProgress', {
        runId,
        level,
        step,
        message,
        at: new Date().toISOString()
      } satisfies ManualSummaryProgressEvent);
    };
    const config = services.config.get();
    const groupName = input.groupName || input.groupCode || '手动选择记录';
    const groupCode = input.groupCode || '';
    const startAt = input.startAt || '';
    const endAt = input.endAt || '';
    let messageCount = 0;
    try {
      sendProgress('info', 'validate', '检查输入参数');
      if (!input.exportFilePath) throw new Error('请选择群聊记录文件');
      if (!input.markdownPath) throw new Error('请选择要写入的 Markdown 文件');
      sendProgress('info', 'parse', `开始解析群聊记录：${input.exportFilePath}`);
      const messages = services.summary.parseExport(input.exportFilePath);
      messageCount = messages.length;
      sendProgress('success', 'parse', `解析完成，共 ${messageCount} 条消息`);
      const plan = {
        id: input.sourceHistoryId || 'manual-summary',
        enabled: true,
        name: '手动总结',
        target: { type: 'group', groupCode, groupName },
        schedule: { type: 'startup', autoRunOnAppLaunch: false, delaySeconds: 0, backfillDays: 0 },
        timeWindow: config.backup.plans[0]?.timeWindow,
        export: config.backup.plans[0]?.export,
        aiSummary: { enabled: true },
        postAction: config.backup.plans[0]?.postAction,
        retry: config.backup.plans[0]?.retry,
        createdAt: startedAt.toISOString(),
        updatedAt: startedAt.toISOString()
      } as BackupPlan;
      const window = {
        startAt,
        endAt,
        startUnix: 0,
        endUnix: 0,
        windowKey: `manual_summary_${input.sourceHistoryId || Date.now()}`
      };
      sendProgress('info', 'summarize', '开始调用 AI 生成总结');
      const summaryMarkdown = await services.summary.summarize(messages, plan, window, config.summary, config.ai, (progress) => {
        sendProgress('info', progress.step, progress.message);
      });
      sendProgress('success', 'summarize', `AI 总结完成，返回 ${summaryMarkdown.length} 字`);
      sendProgress('info', 'write_markdown', `开始写入 Markdown：${input.markdownPath}`);
      const appendResult = services.markdown.appendSummary({
        markdownPath: input.markdownPath,
        duplicatePolicy: input.duplicatePolicy || config.markdown.duplicatePolicy,
        windowKey: window.windowKey,
        title: `${groupName}${startAt || endAt ? ` ${startAt} - ${endAt}` : ''}`,
        metadata: {
          mode: 'manual-summary',
          groupName,
          groupCode,
          startAt,
          endAt,
          messageCount,
          exportFilePath: input.exportFilePath
        },
        summaryMarkdown
      });
      sendProgress(appendResult.skipped ? 'warn' : 'success', 'write_markdown', appendResult.skipped ? `Markdown 已存在相同窗口，已跳过：${appendResult.path}` : `Markdown 写入完成：${appendResult.path}`);
      const finishedAt = new Date();
      const historyItem = services.manualSummaryHistory.upsert({
        sourceHistoryId: input.sourceHistoryId,
        exportFilePath: input.exportFilePath,
        groupName,
        groupCode,
        startAt,
        endAt,
        markdownPath: appendResult.path,
        status: 'success',
        messageCount,
        startedAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
        durationMs: finishedAt.getTime() - startedAt.getTime()
      });
      sendProgress('success', 'done', `手动总结完成，历史已记录。保存到：${appendResult.path}`);
      return { ok: true, historyItem, markdownPath: appendResult.path };
    } catch (error) {
      const finishedAt = new Date();
      const message = error instanceof Error ? error.message : String(error);
      sendProgress('error', 'failed', message);
      const historyItem = services.manualSummaryHistory.upsert({
        sourceHistoryId: input.sourceHistoryId,
        exportFilePath: input.exportFilePath,
        groupName,
        groupCode,
        startAt,
        endAt,
        markdownPath: input.markdownPath,
        status: 'failed',
        messageCount,
        error: message,
        startedAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
        durationMs: finishedAt.getTime() - startedAt.getTime()
      });
      return { ok: false, historyItem, error: message };
    }
  });

  ipcMain.handle('ai:testConnection', (_, providerId?: string, patch?: Partial<AiConfig>) => {
    const config = services.config.get().ai;
    return services.aiClient.testConnection({ ...config, ...patch }, providerId);
  });
  ipcMain.handle('ai:testSummaryWithText', async (_, text: string) => {
    const config = services.config.get();
    return services.aiClient.summarize(config.ai, {
      systemPrompt: config.summary.prompts.systemPrompt,
      userPrompt: text,
      temperature: config.ai.temperature
    });
  });

  ipcMain.handle('markdown:testWrite', (_, input: AppendSummaryInput) => services.markdown.appendSummary(input));
  ipcMain.handle('markdown:openFile', (_, path: string) => shell.openPath(path));
  ipcMain.handle('markdown:openDir', (_, path: string) => shell.openPath(dirname(path)));

  ipcMain.handle('autoLaunch:getStatus', () => services.autoLaunch.getStatus());
  ipcMain.handle('autoLaunch:enable', () => services.autoLaunch.enable());
  ipcMain.handle('autoLaunch:disable', () => services.autoLaunch.disable());

  ipcMain.handle('logs:getRecent', () => services.logs.recent());
  ipcMain.handle('logs:clear', () => services.logs.clear());
  ipcMain.handle('logs:openDir', () => shell.openPath(services.logs.logDir));
}

export function wireEvents(window: BrowserWindow, services: IpcServices): void {
  const send = (channel: string, payload: unknown) => {
    if (!window.isDestroyed()) window.webContents.send(channel, payload);
  };
  services.logs.on('line', (line) => send('logs:line', line));
  services.qceProcess.on('output', (line) => send('qce:output', line));
  services.backupRunner.on('progress', (event) => send('backup:progress', event));
  services.backupRunner.on('status', (status) => send('app:status', status));
}
