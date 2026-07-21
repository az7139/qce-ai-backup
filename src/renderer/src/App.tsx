import { useEffect, useMemo, useRef, useState } from 'react';
import type { AiProviderConfig, AppConfig, BackupHistoryItem, BackupPlan, BackupProgressEvent, BackupRunResult, BackupTarget, ManualSummaryHistoryItem, ManualSummaryProgressEvent, QceDiagnosis, QceGroup, QceUpdateCheckResult } from '../../main/types';
import { defaultExportConfig, defaultOpenAiCompatibleConfig, defaultTimeWindow } from '../../main/types';
import { buildWeeklySummaryMarkdownPath } from '../../shared/weeklyMarkdownPath';
import { StatusCard } from './components/StatusCard';
import { TerminalPanel } from './components/TerminalPanel';

type Tab = 'dashboard' | 'qce' | 'plan' | 'settings' | 'ai' | 'summary' | 'markdown' | 'logs' | 'history';

const tabs: Array<{ id: Tab; label: string }> = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'qce', label: 'QCE 设置' },
  { id: 'plan', label: '计划' },
  { id: 'ai', label: 'AI' },
  { id: 'summary', label: '总结' },
  { id: 'markdown', label: 'Markdown' },
  { id: 'logs', label: '日志' },
  { id: 'history', label: '历史' },
  { id: 'settings', label: '软件设置' }
];

export default function App() {
  const [tab, setTab] = useState<Tab>('dashboard');
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [status, setStatus] = useState('idle');
  const [logs, setLogs] = useState<string[]>([]);
  const [qceOutput, setQceOutput] = useState<string[]>([]);
  const [history, setHistory] = useState<BackupHistoryItem[]>([]);
  const [manualSummaryHistory, setManualSummaryHistory] = useState<ManualSummaryHistoryItem[]>([]);
  const [manualSummaryProgress, setManualSummaryProgress] = useState<ManualSummaryProgressEvent[]>([]);
  const [showManualSummaryDetail, setShowManualSummaryDetail] = useState(false);
  const [groups, setGroups] = useState<QceGroup[]>([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [autoLaunchEnabled, setAutoLaunchEnabled] = useState(false);
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [historyPlanId, setHistoryPlanId] = useState<string | null>(null);
  const [summaryHistoryDetail, setSummaryHistoryDetail] = useState(false);
  const [planProgress, setPlanProgress] = useState<Record<string, BackupProgressEvent>>({});
  const [backupProgressEvents, setBackupProgressEvents] = useState<BackupProgressEvent[]>([]);
  const [showBackupProgressDetail, setShowBackupProgressDetail] = useState(false);
  const [qceUpdateNotice, setQceUpdateNotice] = useState<QceUpdateCheckResult | null>(null);
  const dismissedBackupProgressPlanId = useRef<string | null>(null);

  const activePlan = config?.backup.plans[0];

  useEffect(() => {
    let disposed = false;
    void refresh()
      .then(async (nextConfig) => {
        if (!nextConfig.qce.autoCheckUpdatesOnLaunch) return;
        const result = await window.qceAiBackup.qce.checkUpdate();
        if (!disposed && result.ok && result.updateAvailable) setQceUpdateNotice(result);
      })
      .catch((error) => {
        if (!disposed) setMessage(error instanceof Error ? error.message : String(error));
      });
    const unsubLogs = window.qceAiBackup.logs.onLine((line) => setLogs((old) => [...old.slice(-499), line]));
    const unsubStatus = window.qceAiBackup.events.onAppStatus(setStatus);
    const unsubQce = window.qceAiBackup.events.onQceOutput((chunk) => setQceOutput((old) => [...old.slice(-799), chunk]));
    const unsubManualSummary = window.qceAiBackup.summary.onManualProgress((event) => {
      setManualSummaryProgress((old) => [...old.slice(-299), event]);
      setShowManualSummaryDetail(true);
      setMessage(`${event.step}: ${event.message}`);
    });
    const unsubProgress = window.qceAiBackup.events.onBackupProgress((event) => {
      setMessage(`${event.status}: ${event.message}`);
      setPlanProgress((old) => ({ ...old, [event.planId]: event }));
      setBackupProgressEvents((old) => [...old.slice(-199), event]);
      if (isTerminalBackupStatus(event.status)) {
        dismissedBackupProgressPlanId.current = null;
        if (event.status === 'failed') setShowBackupProgressDetail(true);
      } else if (dismissedBackupProgressPlanId.current !== event.planId) {
        setShowBackupProgressDetail(true);
      }
    });
    return () => {
      disposed = true;
      unsubLogs();
      unsubStatus();
      unsubQce();
      unsubManualSummary();
      unsubProgress();
    };
  }, []);

  async function refresh(): Promise<AppConfig> {
    const [nextConfig, nextLogs, nextHistory, nextManualSummaryHistory, autoLaunchStatus] = await Promise.all([
      window.qceAiBackup.config.get(),
      window.qceAiBackup.logs.getRecent(),
      window.qceAiBackup.backup.listHistory(),
      window.qceAiBackup.summary.listManualHistory(),
      window.qceAiBackup.autoLaunch.getStatus()
    ]);
    setConfig(nextConfig);
    setLogs(nextLogs);
    setHistory(nextHistory);
    setManualSummaryHistory(nextManualSummaryHistory);
    setAutoLaunchEnabled(autoLaunchStatus.enabled);
    return nextConfig;
  }

  async function save(next: AppConfig) {
    const saved = await window.qceAiBackup.config.update(next);
    setConfig(saved);
    setMessage('配置已保存');
  }

  async function run(action: () => Promise<unknown>, okText: string) {
    if (busy) return;
    setBusy(true);
    setMessage('执行中...');
    try {
      const result = await action();
      if (isFailedResult(result)) {
        setMessage(result.error || '执行失败');
      } else {
        setMessage(`${okText}${formatResult(result)}`);
      }
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function updateQce() {
    let completed = false;
    await run(async () => {
      const result = await window.qceAiBackup.qce.update();
      completed = result.ok;
      return result;
    }, 'QCE 更新完成');
    if (completed) setQceUpdateNotice(null);
  }

  const dashboard = useMemo(() => {
    const last = history[0];
    return {
      lastMarkdown: last?.markdownPath ?? '未写入',
      lastError: last?.error ?? '无',
      lastRun: last?.finishedAt ?? '无',
      nextPlan: activePlan?.name ?? '未创建计划'
    };
  }, [history, activePlan]);

  if (!config) return <main className="boot">正在加载配置...</main>;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">QCE AI Backup</div>
        {tabs.map((item) => (
          <button key={item.id} className={tab === item.id ? 'active' : ''} onClick={() => setTab(item.id)}>
            {item.label}
          </button>
        ))}
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div>
            <strong>{tabs.find((item) => item.id === tab)?.label}</strong>
            <span>{message || '准备就绪'}</span>
          </div>
          <button disabled={busy} onClick={() => void refresh()}>刷新</button>
        </header>

        {tab === 'dashboard' ? (
          <section className="page">
            <div className="status-grid">
              <StatusCard title="当前状态" value={status} detail={message} />
              <StatusCard title="当前计划" value={dashboard.nextPlan} />
              <StatusCard title="最近完成" value={dashboard.lastRun} />
              <StatusCard title="最近 Markdown" value={dashboard.lastMarkdown} />
              <StatusCard title="最近错误" value={dashboard.lastError} />
            </div>
            <div className="toolbar">
              <button disabled={busy} onClick={() => void run(() => window.qceAiBackup.qce.start(), 'QCE 已启动')}>启动 QCE</button>
              <button disabled={busy} onClick={() => void run(() => window.qceAiBackup.qce.stop(), 'QCE 已停止')}>停止 QCE</button>
              <button disabled={busy || !activePlan} onClick={() => activePlan && void run(() => window.qceAiBackup.backup.runStartupBackfill(activePlan.id), '补漏检查完成')}>
                立即执行补漏检查
              </button>
              <button disabled={!backupProgressEvents.length} onClick={() => setShowBackupProgressDetail(true)}>
                打开计划进度
              </button>
              <button disabled={busy} onClick={() => void updateQce()}>
                更新 QCE
              </button>
              <button disabled={busy} onClick={() => void run(() => window.qceAiBackup.qce.openWebUi(), '已打开 QCE Web UI')}>打开 QCE Web UI</button>
            </div>
            {qceOutput.length ? <TerminalPanel mode="ansi" chunks={qceOutput} /> : <TerminalPanel lines={logs} />}
          </section>
        ) : null}

        {tab === 'qce' ? <QceSettings config={config} save={save} run={run} /> : null}
        {tab === 'plan' ? (
          <PlanSettings
            config={config}
            save={save}
            run={run}
            setGroups={setGroups}
            groups={groups}
            history={history}
            selectedPlanId={selectedPlanId}
            setSelectedPlanId={setSelectedPlanId}
            historyPlanId={historyPlanId}
            setHistoryPlanId={setHistoryPlanId}
            planProgress={planProgress}
          />
        ) : null}
        {tab === 'settings' ? (
          <SoftwareSettings
            config={config}
            save={save}
            run={run}
            autoLaunchEnabled={autoLaunchEnabled}
            setAutoLaunchEnabled={setAutoLaunchEnabled}
          />
        ) : null}
        {tab === 'ai' ? <AiSettings config={config} save={save} run={run} /> : null}
        {tab === 'summary' ? (
          <SummarySettings
            config={config}
            save={save}
            run={run}
            backupHistory={history}
            manualSummaryHistory={manualSummaryHistory}
            manualSummaryProgress={manualSummaryProgress}
            setManualSummaryProgress={setManualSummaryProgress}
            showExecutionDetail={showManualSummaryDetail}
            setShowExecutionDetail={setShowManualSummaryDetail}
            detail={summaryHistoryDetail}
            setDetail={setSummaryHistoryDetail}
          />
        ) : null}
        {tab === 'markdown' ? <MarkdownSettings config={config} save={save} run={run} activePlan={activePlan} /> : null}
        {tab === 'logs' ? <LogsPage logs={logs} run={run} /> : null}
        {tab === 'history' ? <HistoryPage history={history} /> : null}
      </main>
      {qceUpdateNotice ? (
        <QceUpdateNotice
          notice={qceUpdateNotice}
          busy={busy}
          onClose={() => setQceUpdateNotice(null)}
          onUpdate={() => void updateQce()}
        />
      ) : null}
      {showBackupProgressDetail ? (
        <BackupProgressDialog
          events={backupProgressEvents}
          plans={config.backup.plans}
          onClose={() => {
            const latest = backupProgressEvents[backupProgressEvents.length - 1];
            dismissedBackupProgressPlanId.current = latest?.planId ?? null;
            setShowBackupProgressDetail(false);
          }}
          onClear={() => setBackupProgressEvents([])}
        />
      ) : null}
    </div>
  );
}

function QceUpdateNotice({
  notice,
  busy,
  onClose,
  onUpdate
}: {
  notice: QceUpdateCheckResult;
  busy: boolean;
  onClose: () => void;
  onUpdate: () => void;
}) {
  return (
    <aside className="qce-update-notice" role="status" aria-live="polite">
      <div className="qce-update-notice-header">
        <div>
          <strong>发现 QCE 新版本</strong>
          <span>当前 {formatVersion(notice.currentVersion)}</span>
        </div>
        <button className="icon-button" type="button" title="关闭更新提醒" aria-label="关闭更新提醒" onClick={onClose}>
          ×
        </button>
      </div>
      <p>{formatVersion(notice.latestVersion)} 已可更新。</p>
      <div className="qce-update-notice-actions">
        <button type="button" disabled={busy} onClick={onUpdate}>立即更新</button>
      </div>
    </aside>
  );
}

function QceSettings({ config, save, run }: PageProps) {
  const qce = config.qce;
  return (
    <section className="page form-grid">
      <Field label="QCE Shell 目录" value={qce.qceDir} onChange={(qceDir) => save({ ...config, qce: { ...qce, qceDir } })} />
      <Field label="launcher-user.bat" value={qce.launcherBat} onChange={(launcherBat) => save({ ...config, qce: { ...qce, launcherBat } })} />
      <Field label="快速登录 QQ 号" value={qce.quickLoginUin} onChange={(quickLoginUin) => save({ ...config, qce: { ...qce, quickLoginUin } })} />
      <Field label="QCE Base URL" value={qce.baseUrl} onChange={(baseUrl) => save({ ...config, qce: { ...qce, baseUrl } })} />
      <Field label="security.json" value={qce.securityJsonPath} onChange={(securityJsonPath) => save({ ...config, qce: { ...qce, securityJsonPath } })} />
      <Field label="QCE 更新代理（可选）" value={qce.updateProxyUrl} onChange={(updateProxyUrl) => save({ ...config, qce: { ...qce, updateProxyUrl } })} />
      <Check label="备份成功后关闭 QCE" checked={qce.shutdownQceAfterSuccess} onChange={(value) => save({ ...config, qce: { ...qce, shutdownQceAfterSuccess: value } })} />
      <Check label="显示 QCE 控制台" checked={qce.showQceConsole} onChange={(value) => save({ ...config, qce: { ...qce, showQceConsole: value } })} />
      <div className="toolbar full">
        <button
          onClick={() =>
            void run(async () => {
              const diagnosis = await window.qceAiBackup.qce.diagnose();
              return { message: formatDiagnosis(diagnosis) };
            }, 'QCE API 诊断完成')
          }
        >
          诊断 QCE API
        </button>
        <button onClick={() => void run(() => window.qceAiBackup.qce.validatePath(qce.qceDir), '路径校验完成')}>校验路径</button>
        <button onClick={() => void run(() => window.qceAiBackup.qce.health(), 'health 检查完成')}>测试 health</button>
        <button onClick={() => void run(() => window.qceAiBackup.qce.readTokenPreview(), 'token 读取完成')}>读取 token</button>
      </div>
    </section>
  );
}

function SoftwareSettings({
  config,
  save,
  run,
  autoLaunchEnabled,
  setAutoLaunchEnabled
}: PageProps & {
  autoLaunchEnabled: boolean;
  setAutoLaunchEnabled: (enabled: boolean) => void;
}) {
  const qce = config.qce;
  const backup = config.backup;
  const ui = config.ui;
  const advanced = config.advanced;

  const setAutoLaunch = async (enabled: boolean) => {
    await run(async () => {
      if (enabled) await window.qceAiBackup.autoLaunch.enable();
      else await window.qceAiBackup.autoLaunch.disable();
      setAutoLaunchEnabled(enabled);
      return { message: enabled ? '已启用开机自动启动' : '已关闭开机自动启动' };
    }, '开机自动启动设置已更新');
  };

  return (
    <section className="page settings-page">
      <div className="settings-section">
        <div className="section-title">
          <div>
            <strong>启动行为</strong>
            <span>控制软件和 QCE 在启动时的行为。</span>
          </div>
        </div>
        <div className="form-grid">
          <Check label="开机自动启动软件" checked={autoLaunchEnabled} onChange={(enabled) => void setAutoLaunch(enabled)} />
          <Check label="软件启动时自动检查 QCE 更新" checked={qce.autoCheckUpdatesOnLaunch} onChange={(autoCheckUpdatesOnLaunch) => save({ ...config, qce: { ...qce, autoCheckUpdatesOnLaunch } })} />
          <Check label="软件启动时自动启动 QCE" checked={qce.autoStartOnAppLaunch} onChange={(autoStartOnAppLaunch) => save({ ...config, qce: { ...qce, autoStartOnAppLaunch } })} />
          <Check label="执行备份前自动启动 QCE" checked={qce.autoStartQceBeforeBackup} onChange={(autoStartQceBeforeBackup) => save({ ...config, qce: { ...qce, autoStartQceBeforeBackup } })} />
          <Check label="软件启动时最小化" checked={ui.startMinimized} onChange={(startMinimized) => save({ ...config, ui: { ...ui, startMinimized } })} />
        </div>
      </div>

      <div className="settings-section">
        <div className="section-title">
          <div>
            <strong>QCE 与备份流程</strong>
            <span>这些设置会影响备份任务执行前后的自动处理。</span>
          </div>
        </div>
        <div className="form-grid">
          <Check label="显示 QCE 控制台窗口" checked={qce.showQceConsole} onChange={(showQceConsole) => save({ ...config, qce: { ...qce, showQceConsole } })} />
          <Check label="备份成功后关闭 QCE" checked={qce.shutdownQceAfterSuccess} onChange={(shutdownQceAfterSuccess) => save({ ...config, qce: { ...qce, shutdownQceAfterSuccess } })} />
          <Check label="备份失败后关闭 QCE" checked={qce.shutdownQceAfterFailure} onChange={(shutdownQceAfterFailure) => save({ ...config, qce: { ...qce, shutdownQceAfterFailure } })} />
          <Check label="退出软件时强制关闭 QCE/NapCat" checked={qce.forceKillQceOnShutdown} onChange={(forceKillQceOnShutdown) => save({ ...config, qce: { ...qce, forceKillQceOnShutdown } })} />
          <Check label="避免重复处理同一时间段" checked={backup.preventDuplicateWindow} onChange={(preventDuplicateWindow) => save({ ...config, backup: { ...backup, preventDuplicateWindow } })} />
          <Check label="启动任务成功后退出软件" checked={backup.exitAppAfterStartupSuccess} onChange={(exitAppAfterStartupSuccess) => save({ ...config, backup: { ...backup, exitAppAfterStartupSuccess } })} />
        </div>
      </div>

      <div className="settings-section">
        <div className="section-title">
          <div>
            <strong>高级参数</strong>
            <span>通常保持默认值即可。</span>
          </div>
        </div>
        <div className="form-grid">
          <Field label="QCE 在线等待超时秒数" value={String(qce.onlineTimeoutSeconds)} onChange={(value) => save({ ...config, qce: { ...qce, onlineTimeoutSeconds: Number(value) || qce.onlineTimeoutSeconds } })} />
          <Field label="QCE 上线后历史同步等待秒数" value={String(qce.historySyncDelaySeconds)} onChange={(value) => save({ ...config, qce: { ...qce, historySyncDelaySeconds: Math.max(0, Number(value) || 0) } })} />
          <Field label="任务轮询间隔秒数" value={String(advanced.pollIntervalSeconds)} onChange={(value) => save({ ...config, advanced: { ...advanced, pollIntervalSeconds: Number(value) || advanced.pollIntervalSeconds } })} />
          <Field label="任务超时秒数" value={String(advanced.taskTimeoutSeconds)} onChange={(value) => save({ ...config, advanced: { ...advanced, taskTimeoutSeconds: Number(value) || advanced.taskTimeoutSeconds } })} />
          <Field label="日志保留天数" value={String(advanced.logRetentionDays)} onChange={(value) => save({ ...config, advanced: { ...advanced, logRetentionDays: Number(value) || advanced.logRetentionDays } })} />
        </div>
      </div>
    </section>
  );
}

function PlanSettings({
  config,
  save,
  run,
  groups,
  setGroups,
  history,
  selectedPlanId,
  setSelectedPlanId,
  historyPlanId,
  setHistoryPlanId,
  planProgress
}: PageProps & {
  groups: QceGroup[];
  setGroups: (groups: QceGroup[]) => void;
  history: BackupHistoryItem[];
  selectedPlanId: string | null;
  setSelectedPlanId: (planId: string | null) => void;
  historyPlanId: string | null;
  setHistoryPlanId: (planId: string | null) => void;
  planProgress: Record<string, BackupProgressEvent>;
}) {
  const plans = config.backup.plans;
  const selectedPlan = selectedPlanId ? plans.find((item) => item.id === selectedPlanId) : undefined;
  const historyPlan = historyPlanId ? plans.find((item) => item.id === historyPlanId) : undefined;

  const savePlans = (nextPlans: BackupPlan[]) => save({ ...config, backup: { ...config.backup, plans: nextPlans } });
  const setPlan = (next: BackupPlan) => {
    const index = plans.findIndex((item) => item.id === next.id);
    const stamped = { ...next, updatedAt: new Date().toISOString() };
    const nextPlans = index >= 0 ? plans.map((item) => (item.id === stamped.id ? stamped : item)) : [stamped, ...plans];
    return savePlans(nextPlans);
  };
  const addPlan = async () => {
    const next = createDefaultPlan();
    await savePlans([next, ...plans]);
    setSelectedPlanId(next.id);
  };
  const deletePlan = async (plan: BackupPlan) => {
    if (!window.confirm(`确定删除计划“${plan.name}”吗？历史记录会保留。`)) return;
    await savePlans(plans.filter((item) => item.id !== plan.id));
    if (selectedPlanId === plan.id) setSelectedPlanId(null);
    if (historyPlanId === plan.id) setHistoryPlanId(null);
  };

  if (historyPlanId) {
    const planHistory = history.filter((item) => item.planId === historyPlanId);
    return (
      <section className="page">
        <div className="detail-header">
          <button onClick={() => {
            setHistoryPlanId(null);
            if (historyPlan) setSelectedPlanId(historyPlan.id);
          }}>
            返回计划详情
          </button>
          <div>
            <strong>{historyPlan?.name ?? planHistory[0]?.planName ?? '已删除计划'}</strong>
            <span>全部执行历史 · {planHistory.length} 条</span>
          </div>
          <button onClick={() => {
            setHistoryPlanId(null);
            setSelectedPlanId(null);
          }}>
            返回计划列表
          </button>
        </div>
        <PlanHistory history={planHistory} />
      </section>
    );
  }

  if (selectedPlan) {
    const planHistory = history.filter((item) => item.planId === selectedPlan.id);
    const startupDelay = selectedPlan.schedule.delaySeconds;
    const backfillDays = selectedPlan.schedule.backfillDays;

    return (
      <section className="page">
        <div className="detail-header">
          <button onClick={() => setSelectedPlanId(null)}>返回计划列表</button>
          <div>
            <strong>{selectedPlan.name}</strong>
            <span>{formatPlanStatus(selectedPlan, planHistory[0], planProgress[selectedPlan.id])}</span>
          </div>
          <div className="header-actions">
            <button onClick={() => void run(() => window.qceAiBackup.backup.testExport(selectedPlan.id), '测试导出完成')}>只测试备份</button>
            <button className="danger" onClick={() => void deletePlan(selectedPlan)}>删除计划</button>
          </div>
        </div>

        <div className="form-grid plan-detail">
          <Field label="计划名称" value={selectedPlan.name} onChange={(name) => void setPlan({ ...selectedPlan, name })} />
          <Check label="启用计划" checked={selectedPlan.enabled} onChange={(enabled) => void setPlan({ ...selectedPlan, enabled })} />
          <Check
            label="软件启动后自动进行计划"
            checked={selectedPlan.schedule.autoRunOnAppLaunch}
            onChange={(autoRunOnAppLaunch) => void setPlan({ ...selectedPlan, schedule: { ...selectedPlan.schedule, autoRunOnAppLaunch } })}
          />

          <div className="field full">
            <span>任务模式</span>
            <div className="path-preview">
              <code>软件启动后从昨天 03:00 到今天 05:00 开始，往前共检查 {backfillDays} 个周期，缺失时补备份和总结。</code>
            </div>
          </div>

          <Field label="启动后延迟秒数" value={String(startupDelay)} onChange={(value) => void setPlan({ ...selectedPlan, schedule: { ...selectedPlan.schedule, delaySeconds: Number(value) || 0 } })} />
          <Field label="回看补漏周期数" value={String(backfillDays)} onChange={(value) => void setPlan({ ...selectedPlan, schedule: { ...selectedPlan.schedule, backfillDays: Math.max(1, Number(value) || 7) } })} />

          <GroupTargetEditor plan={selectedPlan} setPlan={setPlan} />
          <Field label="窗口开始日偏移" value={String(selectedPlan.timeWindow.relative?.startDayOffset ?? -1)} onChange={(value) => void setPlan({ ...selectedPlan, timeWindow: { ...selectedPlan.timeWindow, relative: { ...selectedPlan.timeWindow.relative!, startDayOffset: Number(value) } } })} />
          <Field label="窗口开始时间" value={selectedPlan.timeWindow.relative?.startTime ?? '03:00'} onChange={(startTime) => void setPlan({ ...selectedPlan, timeWindow: { ...selectedPlan.timeWindow, relative: { ...selectedPlan.timeWindow.relative!, startTime } } })} />
          <Field label="窗口结束日偏移" value={String(selectedPlan.timeWindow.relative?.endDayOffset ?? 0)} onChange={(value) => void setPlan({ ...selectedPlan, timeWindow: { ...selectedPlan.timeWindow, relative: { ...selectedPlan.timeWindow.relative!, endDayOffset: Number(value) } } })} />
          <Field label="窗口结束时间" value={selectedPlan.timeWindow.relative?.endTime ?? '05:00'} onChange={(endTime) => void setPlan({ ...selectedPlan, timeWindow: { ...selectedPlan.timeWindow, relative: { ...selectedPlan.timeWindow.relative!, endTime } } })} />
          <Field label="导出格式" value={selectedPlan.export.primaryFormatForSummary} onChange={(format) => void setPlan({ ...selectedPlan, export: { ...selectedPlan.export, primaryFormatForSummary: format.toUpperCase() as BackupPlan['export']['primaryFormatForSummary'], archiveFormats: [format.toUpperCase() as BackupPlan['export']['archiveFormats'][number]] } })} />
          <Field label="群聊备份 TXT 保存文件夹" value={selectedPlan.export.outputDir ?? ''} onChange={(outputDir) => void setPlan({ ...selectedPlan, export: { ...selectedPlan.export, outputDir } })} />

          <div className="toolbar full">
            <button
              onClick={() =>
                void run(async () => {
                  const next = await window.qceAiBackup.qce.listGroups();
                  setGroups(next);
                  return next;
                }, '群列表同步完成')
              }
            >
              同步群列表
            </button>
            <button onClick={() => void run(() => window.qceAiBackup.backup.runStartupBackfill(selectedPlan.id), '补漏检查完成')}>立即执行补漏检查</button>
          </div>

          {groups.length ? (
            <div className="table full">
              {groups.map((group) => (
                <button key={group.groupCode} onClick={() => void setPlan(addPlanTarget(selectedPlan, { type: 'group', groupCode: group.groupCode, groupName: group.groupName }))}>
                  {group.groupName || group.groupCode} · {group.groupCode}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <PlanHistory history={planHistory} limit={5} onOpenDetails={() => setHistoryPlanId(selectedPlan.id)} />
      </section>
    );
  }

  return (
    <section className="page">
      <div className="toolbar">
        <button onClick={() => void addPlan()}>新建计划</button>
      </div>
      <div className="plan-list">
        {plans.length ? plans.map((plan) => {
          const latest = history.find((item) => item.planId === plan.id);
          const progress = planProgress[plan.id];
          return (
            <article key={plan.id} className="plan-row">
              <div>
                <strong>{plan.name}</strong>
                <small>{formatPlanStatus(plan, latest, progress)}</small>
              </div>
              <div>
                <span>目标群聊</span>
                <strong>{formatPlanTargetSummary(plan)}</strong>
                <small>{getPlanTargets(plan).map((target) => target.groupCode).filter(Boolean).join(', ')}</small>
              </div>
              <div>
                <span>执行情况</span>
                <strong>{formatSchedule(plan)}</strong>
                <small>{latest ? `最近执行：${formatStatus(latest.status)} · ${formatExecutionTime(latest)}` : '暂无历史'}</small>
              </div>
              <div>
                <span>是否启用</span>
                <label className="inline-check">
                  <input type="checkbox" checked={plan.enabled} onChange={(event) => void setPlan({ ...plan, enabled: event.target.checked })} />
                  {plan.enabled ? '已启用' : '已停用'}
                </label>
              </div>
              <div>
                <span>目标群聊时间段</span>
                <strong>{formatTimeWindow(plan)}</strong>
              </div>
              <div className="row-actions">
                <button onClick={() => setSelectedPlanId(plan.id)}>详细设置</button>
                <button className="danger" onClick={() => void deletePlan(plan)}>删除计划</button>
              </div>
            </article>
          );
        }) : (
          <div className="empty-state">还没有计划。点击“新建计划”开始配置。</div>
        )}
      </div>
    </section>
  );
}

function GroupTargetEditor({ plan, setPlan }: { plan: BackupPlan; setPlan: (plan: BackupPlan) => void | Promise<void> }) {
  const targets = getPlanTargets(plan);
  const updateTarget = (index: number, patch: Partial<BackupTarget>) => {
    const nextTargets = targets.map((target, targetIndex) => (targetIndex === index ? { ...target, ...patch, type: 'group' as const } : target));
    void setPlan(withPlanTargets(plan, nextTargets));
  };
  const removeTarget = (index: number) => {
    const nextTargets = targets.filter((_, targetIndex) => targetIndex !== index);
    void setPlan(withPlanTargets(plan, nextTargets.length ? nextTargets : [{ type: 'group', groupCode: '', groupName: '' }]));
  };

  return (
    <div className="settings-section full">
      <div className="section-title">
        <div>
          <strong>目标群聊</strong>
          <span>备份会分别导出，AI 总结会把这些群聊放在一起总结。</span>
        </div>
        <button onClick={() => void setPlan(withPlanTargets(plan, [...targets, { type: 'group', groupCode: '', groupName: '' }]))}>添加群聊</button>
      </div>
      <div className="target-editor">
        {targets.map((target, index) => (
          <div className="target-row" key={`${target.groupCode || 'new'}-${index}`}>
            <Field label={`群号 ${index + 1}`} value={target.groupCode} onChange={(groupCode) => updateTarget(index, { groupCode })} />
            <Field label={`群名 ${index + 1}`} value={target.groupName ?? ''} onChange={(groupName) => updateTarget(index, { groupName })} />
            <button className="danger" disabled={targets.length <= 1} onClick={() => removeTarget(index)}>移除</button>
          </div>
        ))}
      </div>
    </div>
  );
}

function AiSettings({ config, save, run }: PageProps) {
  const ai = config.ai;
  const providers = normalizeAiProvidersForUi(ai.providers, ai.openaiCompatible);
  const primaryProvider = providers[0];

  const saveProviders = (nextProviders: AiProviderConfig[]) => {
    const normalized = normalizeAiProvidersForUi(nextProviders, ai.openaiCompatible);
    const primary = normalized[0];
    return save({
      ...config,
      ai: {
        ...ai,
        providers: normalized,
        providerType: primary.providerType,
        openaiCompatible: primary.openaiCompatible
      }
    });
  };

  const setProvider = (providerId: string, nextProvider: AiProviderConfig) => {
    return saveProviders(providers.map((provider) => (provider.id === providerId ? nextProvider : provider)));
  };

  const addFallbackProvider = () => {
    return saveProviders([...providers, createAiProvider(`备用 AI ${providers.length}`)]);
  };

  const deleteProvider = (providerId: string) => {
    return saveProviders(providers.filter((provider) => provider.id !== providerId));
  };

  return (
    <section className="page settings-page">
      <div className="settings-section">
        <div className="section-title">
          <div>
            <strong>通用参数</strong>
            <span>这些参数会应用到主 AI 和所有备用 AI。</span>
          </div>
        </div>
        <div className="form-grid">
          <Field label="Temperature" value={String(ai.temperature)} onChange={(temperature) => save({ ...config, ai: { ...ai, temperature: Number(temperature) } })} />
          <Field label="AI 请求超时秒数" value={String(ai.timeoutSeconds)} onChange={(value) => save({ ...config, ai: { ...ai, timeoutSeconds: Number(value) || ai.timeoutSeconds } })} />
          <Field label="单个 AI 最大重试次数" value={String(ai.maxRetries)} onChange={(value) => save({ ...config, ai: { ...ai, maxRetries: Number(value) || 0 } })} />
          <Field label="单个 AI 重试间隔秒数" value={String(ai.retryDelaySeconds)} onChange={(value) => save({ ...config, ai: { ...ai, retryDelaySeconds: Number(value) || ai.retryDelaySeconds } })} />
        </div>
      </div>

      <AiProviderEditor
        provider={primaryProvider}
        title="主 AI"
        canDelete={false}
        onChange={(nextProvider) => void setProvider(primaryProvider.id, nextProvider)}
        onTest={() => void run(() => window.qceAiBackup.ai.testConnection(primaryProvider.id), 'AI 测试完成')}
      />

      <div className="settings-section">
        <div className="section-title">
          <div>
            <strong>备用 AI</strong>
            <span>主 AI 重试后仍失败时，会按下面的顺序继续尝试已启用的备用 AI。</span>
          </div>
          <button onClick={() => void addFallbackProvider()}>新增备用 AI</button>
        </div>
        {providers.slice(1).length ? providers.slice(1).map((provider, index) => (
          <AiProviderEditor
            key={provider.id}
            provider={provider}
            title={`备用 AI ${index + 1}`}
            canDelete
            onChange={(nextProvider) => void setProvider(provider.id, nextProvider)}
            onDelete={() => void deleteProvider(provider.id)}
            onTest={() => void run(() => window.qceAiBackup.ai.testConnection(provider.id), 'AI 测试完成')}
          />
        )) : <div className="empty-state">还没有备用 AI。主 AI 失败时将直接报错。</div>}
      </div>
    </section>
  );
}

function AiProviderEditor({
  provider,
  title,
  canDelete,
  onChange,
  onDelete,
  onTest
}: {
  provider: AiProviderConfig;
  title: string;
  canDelete: boolean;
  onChange: (provider: AiProviderConfig) => void;
  onDelete?: () => void;
  onTest: () => void;
}) {
  const openai = provider.openaiCompatible ?? defaultOpenAiCompatibleConfig;
  const setOpenAi = (patch: Partial<typeof openai>) => onChange({ ...provider, openaiCompatible: { ...openai, ...patch } });
  return (
    <div className="ai-provider-panel">
      <div className="section-title">
        <div>
          <strong>{title}</strong>
          <span>{provider.enabled ? '已启用' : '已停用'} · {openai.model || '未设置模型'}</span>
        </div>
        <div className="header-actions">
          <button onClick={onTest}>测试连接</button>
          {canDelete ? <button className="danger" onClick={onDelete}>删除</button> : null}
        </div>
      </div>
      <div className="form-grid">
        <Field label="名称" value={provider.name} onChange={(name) => onChange({ ...provider, name })} />
        <Check label="启用" checked={provider.enabled} onChange={(enabled) => onChange({ ...provider, enabled })} />
        <Field label="Base URL" value={openai.baseUrl} onChange={(baseUrl) => setOpenAi({ baseUrl })} />
        <Field label="API Key" type="password" value={openai.apiKey} onChange={(apiKey) => setOpenAi({ apiKey })} />
        <Field label="Model" value={openai.model} onChange={(model) => setOpenAi({ model })} />
        <Field label="Chat Completions Path" value={openai.chatCompletionsPath} onChange={(chatCompletionsPath) => setOpenAi({ chatCompletionsPath })} />
        <Field label="Max Output Tokens" value={String(openai.maxOutputTokens ?? 4000)} onChange={(value) => setOpenAi({ maxOutputTokens: Number(value) || 4000 })} />
      </div>
    </div>
  );
}

function SummarySettings({
  config,
  save,
  run,
  backupHistory,
  manualSummaryHistory,
  manualSummaryProgress,
  setManualSummaryProgress,
  showExecutionDetail,
  setShowExecutionDetail,
  detail,
  setDetail
}: Pick<PageProps, 'config' | 'save' | 'run'> & {
  backupHistory: BackupHistoryItem[];
  manualSummaryHistory: ManualSummaryHistoryItem[];
  manualSummaryProgress: ManualSummaryProgressEvent[];
  setManualSummaryProgress: (events: ManualSummaryProgressEvent[]) => void;
  showExecutionDetail: boolean;
  setShowExecutionDetail: (show: boolean) => void;
  detail: boolean;
  setDetail: (detail: boolean) => void;
}) {
  const summary = config.summary;
  const selectableRecords = backupHistory.filter((item) => item.exportFilePath);
  const [selectedHistoryId, setSelectedHistoryId] = useState(selectableRecords[0]?.id ?? '');
  const summaryDir = config.markdown.summaryDir || config.markdown.markdownPath;
  const [markdownPath, setMarkdownPath] = useState('');
  const [customMarkdownPath, setCustomMarkdownPath] = useState(false);
  const selectedRecord = selectableRecords.find((item) => item.id === selectedHistoryId) ?? selectableRecords[0];
  const defaultMarkdownPath = useMemo(
    () => buildWeeklySummaryMarkdownPath(summaryDir, selectedRecord),
    [summaryDir, selectedRecord]
  );

  useEffect(() => {
    if (!selectedHistoryId && selectableRecords[0]) setSelectedHistoryId(selectableRecords[0].id);
  }, [selectedHistoryId, selectableRecords]);

  useEffect(() => {
    if (!customMarkdownPath && defaultMarkdownPath) setMarkdownPath(defaultMarkdownPath);
  }, [customMarkdownPath, defaultMarkdownPath]);

  if (detail) {
    return (
      <section className="page">
        <div className="detail-header">
          <button onClick={() => setDetail(false)}>返回总结页面</button>
          <div>
            <strong>总结执行历史</strong>
            <span>全部记录 · {manualSummaryHistory.length} 条</span>
          </div>
        </div>
        <ManualSummaryHistoryList history={manualSummaryHistory} />
      </section>
    );
  }

  return (
    <section className="page settings-page">
      <div className="settings-section">
        <div className="section-title">
          <div>
            <strong>手动总结</strong>
            <span>选择一份已导出的群聊记录，调用当前 AI 配置并写入指定 Markdown 文件。</span>
          </div>
        </div>
        <div className="form-grid">
          <label className="field full">
            <span>群聊记录</span>
            <select value={selectedHistoryId} onChange={(event) => setSelectedHistoryId(event.target.value)}>
              {selectableRecords.length ? selectableRecords.map((item) => (
                <option key={item.id} value={item.id}>
                  {(item.groupName || item.groupCode)} · {item.startAt} - {item.endAt} · {item.exportFilePath}
                </option>
              )) : <option value="">暂无可总结的导出记录</option>}
            </select>
          </label>
          <Field
            full
            label="保存到 Markdown 文件"
            value={markdownPath}
            onChange={(value) => {
              setCustomMarkdownPath(true);
              setMarkdownPath(value);
            }}
          />
          <div className="field full">
            <span>默认路径</span>
            <div className="path-preview">
              <code>{defaultMarkdownPath || '请选择一份群聊记录'}</code>
              <button
                disabled={!defaultMarkdownPath}
                onClick={() => {
                  setCustomMarkdownPath(false);
                  setMarkdownPath(defaultMarkdownPath);
                }}
              >
                使用默认路径
              </button>
            </div>
          </div>
          <div className="toolbar full">
            <button
              disabled={!selectedRecord?.exportFilePath || !markdownPath}
              onClick={() =>
                selectedRecord && void run(async () => {
                  setManualSummaryProgress([]);
                  setShowExecutionDetail(true);
                  return window.qceAiBackup.summary.runManual({
                    sourceHistoryId: selectedRecord.id,
                    exportFilePath: selectedRecord.exportFilePath!,
                    markdownPath,
                    groupName: selectedRecord.groupName,
                    groupCode: selectedRecord.groupCode,
                    startAt: selectedRecord.startAt,
                    endAt: selectedRecord.endAt,
                    duplicatePolicy: config.markdown.duplicatePolicy
                  });
                }, '手动总结完成')
              }
            >
              开始总结
            </button>
            <button disabled={!markdownPath} onClick={() => void run(() => window.qceAiBackup.markdown.openFile(markdownPath), '已打开 Markdown')}>打开目标 Markdown</button>
          </div>
        </div>
      </div>

      <div className="settings-section">
        <div className="section-title">
          <div>
            <strong>总结执行历史</strong>
            <span>{manualSummaryHistory.length ? `共 ${manualSummaryHistory.length} 条，显示最新 ${Math.min(5, manualSummaryHistory.length)} 条` : '暂无记录'}</span>
          </div>
          {manualSummaryHistory.length ? <button onClick={() => setDetail(true)}>详细历史</button> : null}
        </div>
        <ManualSummaryHistoryList history={manualSummaryHistory.slice(0, 5)} />
      </div>

      {showExecutionDetail ? (
        <ManualSummaryExecutionDetail
          events={manualSummaryProgress}
          onClose={() => setShowExecutionDetail(false)}
          onClear={() => setManualSummaryProgress([])}
        />
      ) : null}

      <div className="settings-section">
        <div className="section-title">
          <div>
            <strong>总结参数与提示词</strong>
            <span>手动总结和计划总结都会使用这些设置。</span>
          </div>
        </div>
        <div className="form-grid">
          <Check label="启用 AI 总结" checked={summary.enabled} onChange={(enabled) => save({ ...config, summary: { ...summary, enabled } })} />
          <Field label="每块最大消息数" value={String(summary.chunking.maxMessagesPerChunk)} onChange={(value) => save({ ...config, summary: { ...summary, chunking: { ...summary.chunking, maxMessagesPerChunk: Number(value) } } })} />
          <Field label="每块最大字符数" value={String(summary.chunking.maxCharsPerChunk)} onChange={(value) => save({ ...config, summary: { ...summary, chunking: { ...summary.chunking, maxCharsPerChunk: Number(value) } } })} />
          <TextArea label="System Prompt" value={summary.prompts.systemPrompt} onChange={(systemPrompt) => save({ ...config, summary: { ...summary, prompts: { ...summary.prompts, systemPrompt } } })} />
          <TextArea label="Chunk Prompt Template" value={summary.prompts.chunkPromptTemplate} onChange={(chunkPromptTemplate) => save({ ...config, summary: { ...summary, prompts: { ...summary.prompts, chunkPromptTemplate } } })} />
          <TextArea label="Final Prompt Template" value={summary.prompts.finalPromptTemplate} onChange={(finalPromptTemplate) => save({ ...config, summary: { ...summary, prompts: { ...summary.prompts, finalPromptTemplate } } })} />
        </div>
      </div>
    </section>
  );
}

function MarkdownSettings({ config, save, run, activePlan }: PageProps & { activePlan?: BackupPlan }) {
  const markdown = config.markdown;
  const summaryDir = markdown.summaryDir || markdown.markdownPath;
  const testMarkdownPath = buildWeeklySummaryMarkdownPath(summaryDir, {
    groupName: activePlan?.target.groupName,
    groupCode: activePlan?.target.groupCode,
    startedAt: new Date().toISOString()
  });
  return (
    <section className="page form-grid">
      <Field
        label="总结 Markdown 保存文件夹"
        value={summaryDir}
        onChange={(summaryDir) => save({ ...config, markdown: { ...markdown, summaryDir } })}
      />
      <Check label="写入 metadata block" checked={markdown.includeMetadataBlock} onChange={(includeMetadataBlock) => save({ ...config, markdown: { ...markdown, includeMetadataBlock } })} />
      <div className="toolbar full">
        <button disabled={!testMarkdownPath} onClick={() => void run(() => window.qceAiBackup.markdown.openFile(testMarkdownPath), '已打开 Markdown')}>打开本周 Markdown</button>
        <button
          disabled={!testMarkdownPath}
          onClick={() =>
            void run(
              () =>
                window.qceAiBackup.markdown.testWrite({
                  markdownPath: testMarkdownPath,
                  duplicatePolicy: markdown.duplicatePolicy,
                  windowKey: `test_${Date.now()}`,
                  title: '测试写入',
                  metadata: { plan: activePlan?.name ?? '测试计划' },
                  summaryMarkdown: '- Markdown 写入测试'
                }),
              '测试写入完成'
            )
          }
        >
          测试写入
        </button>
      </div>
    </section>
  );
}

function LogsPage({ logs, run }: { logs: string[]; run: (action: () => Promise<unknown>, okText: string) => Promise<void> }) {
  return (
    <section className="page">
      <div className="toolbar">
        <button onClick={() => void run(() => window.qceAiBackup.logs.openDir(), '已打开日志目录')}>打开日志目录</button>
        <button onClick={() => void run(() => window.qceAiBackup.logs.clear(), '日志已清空')}>清空日志</button>
      </div>
      <TerminalPanel lines={logs} />
    </section>
  );
}

function HistoryPage({ history }: { history: BackupHistoryItem[] }) {
  return (
    <section className="page">
      <div className="history-list">
        {history.map((item) => (
          <article key={item.id} className="history-row">
            <strong>{item.planName} · {formatStatus(item.status)}</strong>
            <span>{item.groupName || item.groupCode}</span>
            <span>执行时间：{formatExecutionTime(item)}</span>
            <span>耗时：{formatDuration(item.durationMs)}</span>
            <small>聊天窗口：{item.startAt} - {item.endAt}</small>
            <small>{item.error || item.markdownPath || item.exportFilePath}</small>
          </article>
        ))}
      </div>
    </section>
  );
}

function PlanHistory({ history, limit, onOpenDetails }: { history: BackupHistoryItem[]; limit?: number; onOpenDetails?: () => void }) {
  const visibleHistory = typeof limit === 'number' ? history.slice(0, limit) : history;
  return (
    <section className="plan-history">
      <div className="section-title">
        <div>
          <strong>该计划执行历史</strong>
          <span>{history.length ? `共 ${history.length} 条${limit ? `，显示最新 ${Math.min(limit, history.length)} 条` : ''}` : '暂无记录'}</span>
        </div>
        {onOpenDetails && history.length > 0 ? <button onClick={onOpenDetails}>详细历史</button> : null}
      </div>
      <div className="history-list">
        {visibleHistory.map((item) => (
          <article key={item.id} className="history-row">
            <strong>{formatStatus(item.status)} · {formatTrigger(item.trigger)}</strong>
            <span>执行时间：{formatExecutionTime(item)}</span>
            <span>聊天窗口：{item.startAt} - {item.endAt}</span>
            <span>耗时：{formatDuration(item.durationMs)}</span>
            <small>{item.error || item.markdownPath || item.exportFilePath || item.windowKey}</small>
          </article>
        ))}
      </div>
    </section>
  );
}

function ManualSummaryHistoryList({ history }: { history: ManualSummaryHistoryItem[] }) {
  if (!history.length) return <div className="empty-state">暂无总结执行历史。</div>;
  return (
    <div className="history-list">
      {history.map((item) => (
        <article key={item.id} className="history-row">
          <strong>{item.groupName} · {item.status === 'success' ? '成功' : '失败'}</strong>
          <span>执行时间：{formatExecutionTime(item)}</span>
          <span>聊天窗口：{item.startAt && item.endAt ? `${item.startAt} - ${item.endAt}` : '-'}</span>
          <span>耗时：{formatDuration(item.durationMs)}</span>
          <small>{item.error || item.markdownPath}</small>
        </article>
      ))}
    </div>
  );
}

function ManualSummaryExecutionDetail({ events, onClose, onClear }: { events: ManualSummaryProgressEvent[]; onClose: () => void; onClear: () => void }) {
  return (
    <div className="modal-backdrop">
      <section className="execution-dialog">
        <div className="detail-header">
          <div>
            <strong>手动总结执行详情</strong>
            <span>{events.length ? `已记录 ${events.length} 个步骤` : '等待执行步骤...'}</span>
          </div>
          <div className="header-actions">
            <button onClick={onClear}>清空</button>
            <button onClick={onClose}>关闭</button>
          </div>
        </div>
        <div className="execution-log">
          {events.length ? events.map((event, index) => (
            <article key={`${event.runId}-${index}`} className={`execution-line ${event.level}`}>
              <span>{formatTimeOnly(event.at)}</span>
              <strong>{event.step}</strong>
              <p>{event.message}</p>
            </article>
          )) : <div className="empty-state">点击“开始总结”后，这里会显示解析、分块、AI 调用、写入 Markdown 等所有步骤。</div>}
        </div>
      </section>
    </div>
  );
}

function BackupProgressDialog({ events, plans, onClose, onClear }: { events: BackupProgressEvent[]; plans: BackupPlan[]; onClose: () => void; onClear: () => void }) {
  const latest = events[events.length - 1];
  const planName = latest ? plans.find((plan) => plan.id === latest.planId)?.name ?? latest.planId : '等待计划进度';
  return (
    <div className="modal-backdrop">
      <section className="execution-dialog">
        <div className="detail-header">
          <div>
            <strong>计划执行进度</strong>
            <span>{latest ? `${planName} · ${formatStatus(latest.status)} · ${latest.message}` : '等待计划开始...'}</span>
          </div>
          <div className="header-actions">
            <button onClick={onClear}>清空</button>
            <button onClick={onClose}>关闭</button>
          </div>
        </div>
        <div className="execution-log">
          {events.length ? events.map((event, index) => (
            <article key={`${event.planId}-${event.at}-${index}`} className={`execution-line ${backupProgressLevel(event.status)}`}>
              <span>{formatTimeOnly(event.at)}</span>
              <strong>{formatStatus(event.status)}</strong>
              <p>{event.message}</p>
            </article>
          )) : <div className="empty-state">计划开始后，这里会显示检查缺漏、导出、解析、AI 总结、写入 Markdown 等进度。</div>}
        </div>
      </section>
    </div>
  );
}

type PageProps = {
  config: AppConfig;
  save: (config: AppConfig) => Promise<void>;
  run: (action: () => Promise<unknown>, okText: string) => Promise<void>;
};

function Field({ label, value, onChange, type = 'text', full = false }: { label: string; value: string; onChange: (value: string) => void | Promise<void>; type?: string; full?: boolean }) {
  const [draft, setDraft] = useState(value);
  const [composing, setComposing] = useState(false);
  const focusedRef = useRef(false);
  const composingRef = useRef(false);

  useEffect(() => {
    if (!focusedRef.current && !composingRef.current) setDraft(value);
  }, [value]);

  const commit = (next = draft) => {
    if (next !== value) void onChange(next);
  };

  return (
    <label className={full ? 'field full' : 'field'}>
      <span>{label}</span>
      <input
        type={type}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onFocus={() => {
          focusedRef.current = true;
        }}
        onBlur={(event) => {
          focusedRef.current = false;
          if (!composingRef.current) commit(event.currentTarget.value);
        }}
        onCompositionStart={() => {
          composingRef.current = true;
          setComposing(true);
        }}
        onCompositionEnd={(event) => {
          const next = event.currentTarget.value;
          composingRef.current = false;
          setComposing(false);
          setDraft(next);
          if (!focusedRef.current) commit(next);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !composing) {
            commit(event.currentTarget.value);
            event.currentTarget.blur();
          }
        }}
      />
    </label>
  );
}

function TextArea({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void | Promise<void> }) {
  const [draft, setDraft] = useState(value);
  const [composing, setComposing] = useState(false);
  const focusedRef = useRef(false);
  const composingRef = useRef(false);

  useEffect(() => {
    if (!focusedRef.current && !composingRef.current) setDraft(value);
  }, [value]);

  const commit = (next = draft) => {
    if (next !== value) void onChange(next);
  };

  return (
    <label className="field full">
      <span>{label}</span>
      <textarea
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onFocus={() => {
          focusedRef.current = true;
        }}
        onBlur={(event) => {
          focusedRef.current = false;
          if (!composingRef.current) commit(event.currentTarget.value);
        }}
        onCompositionStart={() => {
          composingRef.current = true;
          setComposing(true);
        }}
        onCompositionEnd={(event) => {
          const next = event.currentTarget.value;
          composingRef.current = false;
          setComposing(false);
          setDraft(next);
          if (!focusedRef.current) commit(next);
        }}
        onKeyDown={(event) => {
          if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && !composing) {
            commit(event.currentTarget.value);
            event.currentTarget.blur();
          }
        }}
      />
    </label>
  );
}

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className="check">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

function createDefaultPlan(): BackupPlan {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    enabled: true,
    name: '开机群聊补漏备份与总结',
    target: { type: 'group', groupCode: '', groupName: '' },
    targets: [{ type: 'group', groupCode: '', groupName: '' }],
    schedule: { type: 'startup', autoRunOnAppLaunch: true, delaySeconds: 0, backfillDays: 7 },
    timeWindow: defaultTimeWindow,
    export: defaultExportConfig,
    aiSummary: { enabled: true },
    postAction: {
      shutdownQceAfterBackup: true,
      exitAppAfterBackupWhenStartupMode: true,
      keepQceOpenOnFailure: true
    },
    retry: { maxAttempts: 3, retryDelayMinutes: 10 },
    createdAt: now,
    updatedAt: now
  };
}

function createAiProvider(name: string): AiProviderConfig {
  return {
    id: crypto.randomUUID(),
    name,
    enabled: true,
    role: 'fallback',
    providerType: 'openaiCompatible',
    openaiCompatible: { ...defaultOpenAiCompatibleConfig }
  };
}

function normalizeAiProvidersForUi(providers: AiProviderConfig[] | undefined, legacyOpenAi?: AiProviderConfig['openaiCompatible']): AiProviderConfig[] {
  const source = providers?.length
    ? providers
    : [
        {
          id: 'primary',
          name: '主 AI',
          enabled: true,
          role: 'primary' as const,
          providerType: 'openaiCompatible' as const,
          openaiCompatible: legacyOpenAi ?? defaultOpenAiCompatibleConfig
        }
      ];
  return source.map((provider, index) => ({
    ...provider,
    id: provider.id || (index === 0 ? 'primary' : crypto.randomUUID()),
    name: provider.name || (index === 0 ? '主 AI' : `备用 AI ${index}`),
    enabled: provider.enabled ?? true,
    role: index === 0 ? 'primary' : 'fallback',
    providerType: 'openaiCompatible',
    openaiCompatible: {
      ...defaultOpenAiCompatibleConfig,
      ...(provider.openaiCompatible ?? {})
    }
  }));
}

function getPlanTargets(plan: BackupPlan): BackupTarget[] {
  const source = plan.targets?.length ? plan.targets : [plan.target];
  return source.length ? source : [{ type: 'group', groupCode: '', groupName: '' }];
}

function withPlanTargets(plan: BackupPlan, targets: BackupTarget[]): BackupPlan {
  const normalized = normalizePlanTargets(targets);
  return {
    ...plan,
    target: normalized[0],
    targets: normalized
  };
}

function addPlanTarget(plan: BackupPlan, target: BackupTarget): BackupPlan {
  const targets = getPlanTargets(plan);
  if (targets.some((item) => item.groupCode && item.groupCode === target.groupCode)) return plan;
  return withPlanTargets(plan, [...targets.filter((item) => item.groupCode || item.groupName), target]);
}

function normalizePlanTargets(targets: BackupTarget[]): BackupTarget[] {
  const normalized: BackupTarget[] = [];
  const seen = new Set<string>();
  for (const target of targets) {
    const groupCode = target.groupCode.trim();
    const groupName = target.groupName?.trim();
    if (groupCode && seen.has(groupCode)) continue;
    if (groupCode) seen.add(groupCode);
    normalized.push({ type: 'group', groupCode, groupName });
  }
  return normalized.length ? normalized : [{ type: 'group', groupCode: '', groupName: '' }];
}

function formatPlanTargetSummary(plan: BackupPlan): string {
  const targets = getPlanTargets(plan).filter((target) => target.groupCode || target.groupName);
  if (!targets.length) return '未设置';
  if (targets.length === 1) return targets[0].groupName || targets[0].groupCode || '未设置';
  const names = targets.slice(0, 3).map((target) => target.groupName || target.groupCode);
  return `${names.join('、')}${targets.length > 3 ? ` 等 ${targets.length} 个群` : ` 共 ${targets.length} 个群`}`;
}

function formatVersion(version?: string): string {
  if (!version) return '未知版本';
  return version.toLowerCase().startsWith('v') ? version : `v${version}`;
}

function formatDiagnosis(diagnosis: QceDiagnosis): string {
  const failedItems = diagnosis.items.filter((item) => !item.ok);
  const itemText = (failedItems.length ? failedItems : diagnosis.items)
    .map((item) => `${item.name}: ${item.detail}`)
    .join('；');
  const hintText = diagnosis.hints.length ? `；建议：${diagnosis.hints.join('；')}` : '';
  return `${diagnosis.ok ? '通过' : '未通过'}；${itemText}${hintText}`;
}

function formatPlanStatus(plan: BackupPlan, latest?: BackupHistoryItem, progress?: BackupProgressEvent): string {
  if (!plan.enabled) return '已停用';
  if (progress && !['success', 'done', 'failed', 'export_success'].includes(progress.status)) {
    return `运行中 · ${formatStatus(progress.status)} · ${progress.message}`;
  }
  if (!latest) return '已启用 · 暂无执行记录';
  return `已启用 · 最近${formatStatus(latest.status)} · ${latest.finishedAt ?? latest.startedAt}`;
}

function formatSchedule(plan: BackupPlan): string {
  const delay = plan.schedule.delaySeconds ? `延迟 ${plan.schedule.delaySeconds}s，` : '';
  const autoRun = plan.schedule.autoRunOnAppLaunch ? '软件启动后自动补漏' : '软件启动后不自动执行';
  return `${autoRun}，${delay}回看 ${plan.schedule.backfillDays} 个周期`;
}

function formatTimeWindow(plan: BackupPlan): string {
  if (plan.timeWindow.mode === 'absolute' && plan.timeWindow.absolute) {
    return `${plan.timeWindow.absolute.startAt} - ${plan.timeWindow.absolute.endAt}`;
  }
  const relative = plan.timeWindow.relative ?? defaultTimeWindow.relative!;
  return `运行日${formatDayOffset(relative.startDayOffset)} ${relative.startTime} - 运行日${formatDayOffset(relative.endDayOffset)} ${relative.endTime}`;
}

function formatDayOffset(offset: number): string {
  if (offset === 0) return '';
  return offset > 0 ? `+${offset}` : String(offset);
}

function formatStatus(status: string): string {
  const labels: Record<string, string> = {
    idle: '空闲',
    qce_starting: '启动 QCE',
    waiting_login: '等待登录',
    qce_online: 'QCE 在线',
    exporting: '导出中',
    export_success: '导出成功',
    parsing: '解析中',
    summarizing: '总结中',
    writing_markdown: '写入 Markdown',
    success: '成功',
    cleanup: '清理中',
    done: '完成',
    failed: '失败'
  };
  return labels[status] ?? status;
}

function formatTrigger(trigger: BackupHistoryItem['trigger']): string {
  if (trigger === 'startup') return '软件启动';
  if (trigger === 'schedule') return '定时';
  return '手动';
}

function formatExecutionTime(item: { startedAt: string; finishedAt?: string }): string {
  const started = formatDateTime(item.startedAt);
  const finished = item.finishedAt ? formatDateTime(item.finishedAt) : '';
  return finished && finished !== started ? `${started} - ${finished}` : started;
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value || '-';
  return date.toLocaleString('zh-CN', { hour12: false });
}

function formatDuration(durationMs?: number): string {
  if (!durationMs || durationMs < 0) return '-';
  const seconds = Math.round(durationMs / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function formatTimeOnly(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString('zh-CN', { hour12: false });
}

function formatResult(result: unknown): string {
  if (Array.isArray(result)) {
    const failed = result.filter((item) => item && typeof item === 'object' && 'ok' in item && item.ok === false).length;
    return `：检查 ${result.length} 个周期，${failed ? `失败 ${failed} 个` : '全部完成或已跳过'}`;
  }
  if (!result || typeof result !== 'object') return '';
  const value = result as Partial<BackupRunResult> & { message?: string; ok?: boolean };
  if (value.message) return `：${value.message}`;
  if ('ok' in value) return `：${value.ok ? '成功' : '失败'}${value.error ? `，${value.error}` : ''}`;
  return '';
}

function isFailedResult(result: unknown): result is BackupRunResult & { ok: false } {
  return Boolean(result && typeof result === 'object' && 'ok' in result && (result as BackupRunResult).ok === false);
}

function isTerminalBackupStatus(status: BackupProgressEvent['status']): boolean {
  return ['success', 'done', 'failed'].includes(status);
}

function backupProgressLevel(status: BackupProgressEvent['status']): 'success' | 'warn' | 'error' | '' {
  if (status === 'failed') return 'error';
  if (status === 'waiting_login') return 'warn';
  if (isTerminalBackupStatus(status)) return 'success';
  return '';
}
