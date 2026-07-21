import { EventEmitter } from 'node:events';
import { copyFileSync, mkdirSync, unlinkSync } from 'node:fs';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import dayjs from 'dayjs';
import type { AppConfig, BackupPlan, BackupTarget } from '../types/config';
import type { AppRunStatus, BackupProgressEvent, BackupRunResult, BackupWindow, ChatMessage } from '../types/backup';
import { ConfigService } from './configService';
import { QceProcessService } from './qceProcessService';
import { QceApiClient } from './qceApiClient';
import { SummaryService } from './summaryService';
import { MarkdownAppendService } from './markdownAppendService';
import { HistoryService } from './historyService';
import { LogService } from './logService';
import { buildWeeklySummaryMarkdownPath } from '../../shared/weeklyMarkdownPath';

export class BackupRunner extends EventEmitter {
  private readonly runningPlanIds = new Set<string>();
  private historySyncSessionId?: number;
  private historySyncObservedAt?: number;
  private historySyncReady = false;

  constructor(
    private readonly configService: ConfigService,
    private readonly qceProcess: QceProcessService,
    private readonly qceApi: QceApiClient,
    private readonly summary: SummaryService,
    private readonly markdown: MarkdownAppendService,
    private readonly history: HistoryService,
    private readonly logs: LogService
  ) {
    super();
  }

  async runPlan(
    planId: string,
    trigger: 'manual' | 'startup' | 'schedule' = 'manual',
    options: boolean | { exportOnly?: boolean; healthTimeoutSeconds?: number; runDate?: Date | string } = false
  ): Promise<BackupRunResult> {
    const exportOnly = typeof options === 'boolean' ? options : Boolean(options.exportOnly);
    const healthTimeoutSeconds = typeof options === 'boolean' ? undefined : options.healthTimeoutSeconds;
    const runDate = typeof options === 'boolean' || !options.runDate ? new Date() : new Date(options.runDate);
    const config = this.configService.get();
    const plan = config.backup.plans.find((item) => item.id === planId);
    if (!plan) throw new Error(`找不到备份计划：${planId}`);
    if (this.runningPlanIds.has(planId)) {
      return { ok: false, status: 'failed', planId, error: '该计划已有任务正在运行，请等待当前任务结束' };
    }
    this.runningPlanIds.add(planId);
    const startedAt = new Date();
    let window: BackupWindow | undefined;
    let exportFilePath: string | undefined;
    let markdownPath: string | undefined;

    try {
      const targets = getPlanTargets(plan);
      if (!targets.length || targets.some((target) => !target.groupCode.trim())) {
        throw new Error('目标群号为空，请先在“计划”页填写群号');
      }
      if (!config.qce.baseUrl.trim()) {
        throw new Error('QCE Base URL 为空，请先在“QCE 设置”页配置');
      }
      window = computeBackupWindow(plan, runDate);
      const summaryTarget = buildSummaryTarget(plan, targets);
      const summaryWindowKey = buildSummaryWindowKey(plan, targets, window);
      const expectedMarkdownPath = buildWeeklySummaryMarkdownPath(config.markdown.summaryDir || config.markdown.markdownPath, {
        groupName: summaryTarget.groupName,
        groupCode: summaryTarget.groupCode,
        startAt: window.startAt
      });
      if (
        !exportOnly &&
        config.backup.preventDuplicateWindow &&
        this.isPlanWindowComplete(plan, targets, window, expectedMarkdownPath)
      ) {
        this.logs.info('backup', `窗口已成功处理，跳过：${summaryWindowKey}`);
        return { ok: true, status: 'done', planId, windowKey: summaryWindowKey };
      }

      this.progress(plan, 'qce_starting', '准备启动或复用 QCE');
      if (config.qce.autoStartQceBeforeBackup) this.qceProcess.start(config.qce);
      await this.waitForQceOnline(config, plan, healthTimeoutSeconds);
      await this.waitForQceHistorySync(config, plan);

      const exported: Array<{ target: BackupTarget; window: BackupWindow; exportFilePath: string }> = [];
      for (const target of targets) {
        const targetWindow = computeBackupWindow(plan, runDate, target);
        const existingExport = config.backup.preventDuplicateWindow
          ? this.history.findExportByWindowKey(targetWindow.windowKey, { exportDir: plan.export.outputDir })
          : undefined;
        if (existingExport?.exportFilePath) {
          this.progress(plan, 'export_success', `复用已导出的群聊备份：${formatTargetLabel(target)} ${existingExport.exportFilePath}`);
          exported.push({ target, window: targetWindow, exportFilePath: existingExport.exportFilePath });
          continue;
        }
        const nextExportFilePath = await this.exportTarget(config, plan, target, targetWindow);
        await this.recordHistory(plan, targetWindow, trigger, 'export_success', startedAt, nextExportFilePath, undefined, undefined, target);
        exported.push({ target, window: targetWindow, exportFilePath: nextExportFilePath });
      }
      exportFilePath = exported[0]?.exportFilePath;
      const exportFilePaths = exported.map((item) => item.exportFilePath);

      if (exportOnly) {
        return { ok: true, status: 'export_success', planId, windowKey: summaryWindowKey, exportFilePath, exportFilePaths };
      }

      this.progress(plan, 'parsing', '解析聊天记录');
      const messages = exported.flatMap((item) => annotateGroupMessages(this.summary.parseExport(item.exportFilePath), item.target));
      if (!config.summary.enabled || !plan.aiSummary.enabled) {
        throw new Error('AI 总结未启用，无法写入总结 Markdown');
      }

      this.progress(plan, 'summarizing', '调用 AI 总结');
      const summaryWindow = window;
      const summaryPlan = { ...plan, target: summaryTarget };
      const summaryMarkdown = await this.summary.summarize(messages, summaryPlan, summaryWindow, config.summary, config.ai, (event) => {
        this.progress(plan, 'summarizing', `${summaryWindow.startAt} - ${summaryWindow.endAt}：${formatSummaryProgress(event)}`);
      });

      this.progress(plan, 'writing_markdown', '写入 Markdown');
      const title = `${summaryTarget.groupName || summaryTarget.groupCode} ${window.startAt} - ${window.endAt}`;
      const targetMarkdownPath = buildWeeklySummaryMarkdownPath(config.markdown.summaryDir || config.markdown.markdownPath, {
        groupName: summaryTarget.groupName,
        groupCode: summaryTarget.groupCode,
        startAt: window.startAt,
        exportFilePath
      });
      const appendResult = this.markdown.appendSummary({
        markdownPath: targetMarkdownPath,
        duplicatePolicy: config.markdown.duplicatePolicy,
        windowKey: summaryWindowKey,
        title,
        metadata: {
          plan: plan.name,
          groupCode: targets.map((target) => target.groupCode).join(', '),
          groupName: targets.map(formatTargetLabel).join(', '),
          startAt: window.startAt,
          endAt: window.endAt,
          messageCount: messages.length,
          exportFilePath: exportFilePaths.join('; ')
        },
        summaryMarkdown
      });
      markdownPath = appendResult.path;

      this.progress(plan, 'success', '备份、总结和 Markdown 写入完成');
      await this.recordHistory(plan, { ...window, windowKey: summaryWindowKey }, trigger, 'success', startedAt, exportFilePath, markdownPath, undefined, summaryTarget);
      if (plan.postAction.shutdownQceAfterBackup && config.qce.shutdownQceAfterSuccess) await this.qceProcess.stop(true);
      return { ok: true, status: 'success', planId, windowKey: summaryWindowKey, exportFilePath, exportFilePaths, markdownPath };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logs.error('backup', message);
      if (window) await this.recordHistory(plan, window, trigger, 'failed', startedAt, exportFilePath, markdownPath, message);
      if (config.qce.shutdownQceAfterFailure && !plan.postAction.keepQceOpenOnFailure) await this.qceProcess.stop(true);
      this.progress(plan, 'failed', message);
      return { ok: false, status: 'failed', planId, windowKey: window?.windowKey, exportFilePath, markdownPath, error: message };
    } finally {
      this.runningPlanIds.delete(planId);
    }
  }

  async runStartupBackfill(planId: string, trigger: 'startup' | 'manual' = 'startup'): Promise<BackupRunResult[]> {
    const config = this.configService.get();
    const plan = config.backup.plans.find((item) => item.id === planId);
    if (!plan) throw new Error(`找不到备份计划：${planId}`);
    if (!plan.enabled) return [];

    const delaySeconds = Math.max(0, Number(plan.schedule.delaySeconds) || 0);
    if (delaySeconds > 0) {
      this.progress(plan, 'idle', `启动补漏检查将在 ${delaySeconds} 秒后开始`);
      await sleep(delaySeconds * 1000);
    }

    const results: BackupRunResult[] = [];
    const now = new Date();
    const cyclesToCheck = plan.timeWindow.mode === 'absolute' ? 1 : Math.max(1, Number(plan.schedule.backfillDays) || 7);
    for (let dayOffset = 0; dayOffset < cyclesToCheck; dayOffset += 1) {
      const runDate = dayjs(now).subtract(dayOffset, 'day').toDate();
      const window = computeBackupWindow(plan, runDate);
      if (!isBackupWindowComplete(plan, window, now)) {
        this.logs.info('backup', `${plan.name}: 窗口尚未结束，跳过本次检查：${window.startAt} - ${window.endAt}`);
        continue;
      }
      const targets = getPlanTargets(plan);
      const summaryTarget = buildSummaryTarget(plan, targets);
      const expectedMarkdownPath = buildWeeklySummaryMarkdownPath(config.markdown.summaryDir || config.markdown.markdownPath, {
        groupName: summaryTarget.groupName,
        groupCode: summaryTarget.groupCode,
        startAt: window.startAt
      });
      if (
        config.backup.preventDuplicateWindow &&
        this.isPlanWindowComplete(plan, targets, window, expectedMarkdownPath)
      ) {
        const summaryWindowKey = buildSummaryWindowKey(plan, targets, window);
        this.logs.info('backup', `${plan.name}: 已存在成功记录，跳过：${summaryWindowKey}`);
        results.push({ ok: true, status: 'done', planId, windowKey: summaryWindowKey });
        continue;
      }
      this.progress(plan, 'exporting', `发现缺漏，开始补 ${window.startAt} - ${window.endAt}`);
      const result = await this.runPlan(plan.id, trigger, { runDate });
      results.push(result);
    }
    this.progress(plan, results.some((result) => !result.ok) ? 'failed' : 'done', `启动补漏检查完成，共检查 ${cyclesToCheck} 个周期`);
    return results;
  }

  private async exportTarget(config: AppConfig, plan: BackupPlan, target: BackupTarget, window: BackupWindow): Promise<string> {
    this.progress(plan, 'exporting', `创建 QCE 导出任务：${formatTargetLabel(target)}`);
    const taskInput = {
      peer: { chatType: 2 as const, peerUid: target.groupCode, guildId: '' as const },
      sessionName: target.groupName || target.groupCode,
      format: plan.export.primaryFormatForSummary,
      filter: {
        startTime: window.startUnix,
        endTime: window.endUnix,
        keywords: plan.export.keywords,
        excludeUserUins: plan.export.excludeUserUins,
        includeUserUins: plan.export.includeUserUins,
        includeRecalled: plan.export.includeRecalled
      },
      options: {
        batchSize: plan.export.batchSize,
        includeResourceLinks: plan.export.includeResourceLinks,
        includeSystemMessages: plan.export.includeSystemMessages,
        filterPureImageMessages: plan.export.filterPureImageMessages,
        prettyFormat: plan.export.prettyFormat,
        exportAsZip: false,
        preferGroupMemberName: plan.export.preferGroupMemberName,
        outputDir: plan.export.outputDir,
        useNameInFileName: plan.export.useNameInFileName,
        useFriendlyFileName: plan.export.useFriendlyFileName,
        skipDownloadResourceTypes: plan.export.skipDownloadResourceTypes
      }
    };
    const exportTask = await this.qceApi.createExportTask(config.qce, taskInput);
    const completedTask = await this.waitForTask(config, exportTask.taskId);
    const downloadedPath = await this.qceApi.downloadExport(config.qce, {
      ...exportTask,
      ...completedTask,
      downloadUrl: completedTask.downloadUrl ?? exportTask.downloadUrl,
      filePath: completedTask.filePath ?? exportTask.filePath
    });
    const exportFilePath = normalizeExportBackupFile(downloadedPath, plan, target, window);
    this.progress(plan, 'export_success', `导出完成：${formatTargetLabel(target)} ${exportFilePath}`);
    return exportFilePath;
  }

  private isPlanWindowComplete(plan: BackupPlan, targets: BackupTarget[], window: BackupWindow, expectedMarkdownPath: string): boolean {
    const exportsComplete = targets.every((target) => {
      const targetWindow = { ...window, windowKey: buildTargetWindowKey(plan, target, window) };
      return Boolean(this.history.findExportByWindowKey(targetWindow.windowKey, { exportDir: plan.export.outputDir }));
    });
    if (!exportsComplete) return false;
    const summaryWindowKey = buildSummaryWindowKey(plan, targets, window);
    return Boolean(this.history.findSummaryByWindowKey(summaryWindowKey, { markdownPath: expectedMarkdownPath }));
  }

  private async waitForQceOnline(config: AppConfig, plan: BackupPlan, timeoutSeconds = config.qce.onlineTimeoutSeconds): Promise<void> {
    const deadline = Date.now() + timeoutSeconds * 1000;
    let lastError = '';
    while (Date.now() < deadline) {
      const health = await this.qceApi.health(config.qce);
      if (health.online) {
        this.logs.info('qce', 'QCE online');
        return;
      }
      lastError = health.error || (health.ok ? 'health 返回 online=false' : 'health 请求失败');
      this.progress(
        plan,
        'waiting_login',
        `等待 QCE API 在线：${config.qce.baseUrl}/health；最近状态：${lastError}`
      );
      await sleep(3000);
    }
    throw new Error(
      `QCE API 未启动或 Base URL 错误：${config.qce.baseUrl}/health 在 ${timeoutSeconds} 秒内不可用。` +
      `最近错误：${lastError}。请确认完整模式的 http://localhost:40653/qce-v4-tool 能打开；` +
      `NapCat WebUI 端口 6099 不是 QCE 导出 API。`
    );
  }

  private async waitForQceHistorySync(config: AppConfig, plan: BackupPlan): Promise<void> {
    const delaySeconds = Math.max(0, Number(config.qce.historySyncDelaySeconds) || 0);
    const sessionId = this.qceProcess.sessionId;
    if (this.historySyncSessionId !== sessionId) {
      this.historySyncSessionId = sessionId;
      this.historySyncObservedAt = Date.now();
      this.historySyncReady = false;
    }
    if (this.historySyncReady || delaySeconds === 0) {
      this.historySyncReady = true;
      return;
    }

    const deadline = (this.historySyncObservedAt ?? Date.now()) + delaySeconds * 1000;
    while (Date.now() < deadline) {
      const remainingSeconds = Math.ceil((deadline - Date.now()) / 1000);
      this.progress(plan, 'waiting_login', `QCE 已在线，等待 QQ 历史消息同步：剩余 ${remainingSeconds} 秒`);
      await sleep(Math.min(5000, Math.max(1, deadline - Date.now())));
    }
    this.historySyncReady = true;
    this.progress(plan, 'qce_online', 'QCE 历史消息同步等待完成，开始导出');
  }

  private async waitForTask(config: AppConfig, taskId: string) {
    const deadline = Date.now() + config.advanced.taskTimeoutSeconds * 1000;
    while (Date.now() < deadline) {
      const task = await this.qceApi.getTask(config.qce, taskId);
      if (task.status === 'success') return task;
      if (task.status === 'failed') throw new Error(task.error || 'QCE 导出任务失败');
      await sleep(config.advanced.pollIntervalSeconds * 1000);
    }
    throw new Error('QCE 导出任务超时');
  }

  private async recordHistory(
    plan: BackupPlan,
    window: BackupWindow,
    trigger: 'manual' | 'startup' | 'schedule',
    status: AppRunStatus,
    startedAt: Date,
    exportFilePath?: string,
    markdownPath?: string,
    error?: string,
    target: BackupTarget = plan.target
  ): Promise<void> {
    const finishedAt = new Date();
    this.history.upsert({
      planId: plan.id,
      planName: plan.name,
      groupCode: target.groupCode,
      groupName: target.groupName,
      windowKey: window.windowKey,
      startAt: window.startAt,
      endAt: window.endAt,
      trigger,
      status,
      exportStatus: exportFilePath ? 'export_success' : undefined,
      summaryStatus: status === 'success' ? 'success' : undefined,
      markdownStatus: markdownPath ? 'writing_markdown' : undefined,
      exportFilePath,
      markdownPath,
      error,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt.getTime() - startedAt.getTime()
    });
  }

  private progress(plan: BackupPlan, status: AppRunStatus, message: string): void {
    const event: BackupProgressEvent = { planId: plan.id, status, message, at: new Date().toISOString() };
    this.logs.info('backup', `${plan.name}: ${message}`);
    this.emit('progress', event);
    this.emit('status', status);
  }
}

export function computeBackupWindow(plan: BackupPlan, runDate = new Date(), target: BackupTarget = plan.target): BackupWindow {
  const window = plan.timeWindow;
  const start =
    window.mode === 'absolute' && window.absolute
      ? dayjs(window.absolute.startAt)
      : dateWithOffsetAndTime(runDate, window.relative?.startDayOffset ?? -1, window.relative?.startTime ?? '03:00');
  const end =
    window.mode === 'absolute' && window.absolute
      ? dayjs(window.absolute.endAt)
      : dateWithOffsetAndTime(runDate, window.relative?.endDayOffset ?? 0, window.relative?.endTime ?? '05:00');
  const startAt = start.format('YYYY-MM-DD HH:mm:ss');
  const endAt = end.format('YYYY-MM-DD HH:mm:ss');
  return {
    startAt,
    endAt,
    startUnix: Math.floor(start.valueOf() / 1000),
    endUnix: Math.floor(end.valueOf() / 1000),
    windowKey: `${plan.id}_${target.groupCode}_${start.format('YYYYMMDDHHmm')}_${end.format('YYYYMMDDHHmm')}`
  };
}

function isBackupWindowComplete(plan: BackupPlan, window: BackupWindow, now: Date): boolean {
  const minDelayMs = Math.max(0, plan.timeWindow.minDelayAfterWindowEndMinutes || 0) * 60 * 1000;
  return window.endUnix * 1000 + minDelayMs <= now.getTime();
}

function dateWithOffsetAndTime(runDate: Date, dayOffset: number, time: string) {
  const [hour, minute] = time.split(':').map(Number);
  return dayjs(runDate).startOf('day').add(dayOffset, 'day').hour(hour).minute(minute).second(0).millisecond(0);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeExportBackupFile(sourcePath: string, plan: BackupPlan, target: BackupTarget, window: BackupWindow): string {
  const targetPath = buildExportBackupPath(sourcePath, plan, target, window);
  if (isSamePath(sourcePath, targetPath)) return sourcePath;

  mkdirSync(dirname(targetPath), { recursive: true });
  copyFileSync(sourcePath, targetPath);
  try {
    unlinkSync(sourcePath);
  } catch {
    // QCE may still hold the original file briefly; the normalized copy is already ready.
  }
  return targetPath;
}

function buildExportBackupPath(sourcePath: string, plan: BackupPlan, target: BackupTarget, window: BackupWindow): string {
  const outputDir = plan.export.outputDir?.trim() || dirname(sourcePath);
  const extension = extname(sourcePath) || `.${plan.export.primaryFormatForSummary.toLowerCase()}`;
  const groupLabel = formatTargetLabel(target);
  const start = dayjs(window.startAt).format('YYYYMMDD_HHmm');
  const end = dayjs(window.endAt).format('YYYYMMDD_HHmm');
  return join(outputDir, `${sanitizeFileName(`${groupLabel}_${start}-${end}`)}${extension}`);
}

function formatTargetLabel(target: BackupTarget): string {
  const name = (target.groupName || target.groupCode || 'group').trim();
  const code = target.groupCode.trim();
  if (!code || name.includes(code)) return name;
  return `${name}(${code})`;
}

function getPlanTargets(plan: BackupPlan): BackupTarget[] {
  const source = plan.targets?.length ? plan.targets : [plan.target];
  const targets: BackupTarget[] = [];
  const seen = new Set<string>();
  for (const target of source) {
    const groupCode = target.groupCode.trim();
    const groupName = target.groupName?.trim();
    if (!groupCode) continue;
    if (seen.has(groupCode)) continue;
    seen.add(groupCode);
    targets.push({ type: 'group', groupCode, groupName });
  }
  return targets;
}

function buildSummaryTarget(plan: BackupPlan, targets: BackupTarget[]): BackupTarget {
  if (targets.length === 1) return targets[0];
  return {
    type: 'group',
    groupCode: targets.map((target) => target.groupCode).join('+'),
    groupName: `${plan.name} 多群合集`
  };
}

function buildSummaryWindowKey(plan: BackupPlan, targets: BackupTarget[], window: BackupWindow): string {
  if (targets.length === 1) return buildTargetWindowKey(plan, targets[0], window);
  const start = dayjs(window.startAt).format('YYYYMMDDHHmm');
  const end = dayjs(window.endAt).format('YYYYMMDDHHmm');
  return `${plan.id}_${targets.map((target) => target.groupCode).join('-')}_summary_${start}_${end}`;
}

function buildTargetWindowKey(plan: BackupPlan, target: BackupTarget, window: BackupWindow): string {
  const start = dayjs(window.startAt).format('YYYYMMDDHHmm');
  const end = dayjs(window.endAt).format('YYYYMMDDHHmm');
  return `${plan.id}_${target.groupCode}_${start}_${end}`;
}

function annotateGroupMessages(messages: ChatMessage[], target: BackupTarget): ChatMessage[] {
  const label = formatTargetLabel(target);
  return messages.map((message) => ({
    ...message,
    content: `[群聊：${label}] ${message.content}`
  }));
}

function sanitizeFileName(value: string): string {
  return (
    value
      .replace(/[\\/:*?"<>|]/g, '_')
      .replace(/\s+/g, '')
      .replace(/_+/g, '_')
      .replace(/^_+|_+$/g, '') || 'backup'
  );
}

function isSamePath(left: string, right: string): boolean {
  return normalize(resolve(left)).toLowerCase() === normalize(resolve(right)).toLowerCase();
}

function formatSummaryProgress(event: { step: string; message: string }): string {
  const labels: Record<string, string> = {
    chunking: '拆分聊天记录',
    ai_chunk: '分块总结开始',
    ai_chunk_done: '分块总结完成',
    ai_final: '合并分块总结',
    ai_final_fallback: '合并失败降级',
    summary_done: '总结完成'
  };
  const label = labels[event.step] ?? event.step;
  return `${label} - ${event.message}`;
}
