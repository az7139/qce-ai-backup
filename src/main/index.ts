import { BrowserWindow, Menu, Tray, app, nativeImage } from 'electron';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ConfigService } from './services/configService';
import { LogService } from './services/logService';
import { QceProcessService } from './services/qceProcessService';
import { QceUpdateService } from './services/qceUpdateService';
import { QceApiClient } from './services/qceApiClient';
import { AiClient } from './services/aiClient';
import { SummaryService } from './services/summaryService';
import { MarkdownAppendService } from './services/markdownAppendService';
import { HistoryService } from './services/historyService';
import { ManualSummaryHistoryService } from './services/manualSummaryHistoryService';
import { BackupRunner } from './services/backupRunner';
import { AutoLaunchService } from './services/autoLaunchService';
import { getDueStartupPlans } from './services/backupScheduler';
import { registerIpcHandlers, wireEvents } from './ipc/ipcHandlers';
import { cleanupQceProcessTrees } from './services/processKillService';

app.setName('QCE AI Backup');
app.setPath('userData', join(process.env.APPDATA ?? process.cwd(), 'QCE AI Backup'));

let mainWindow: BrowserWindow | undefined;
let tray: Tray | undefined;
let isQuitting = false;
let isQuitCleanupRunning = false;
let qceProcessForQuit: QceProcessService | undefined;
let logsForQuit: LogService | undefined;
let configForQuit: ConfigService | undefined;

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();

const isStartup = process.argv.includes('--startup');
const hidden = process.argv.includes('--hidden');
const runDue = process.argv.includes('--run-due');
const openUi = process.argv.includes('--open-ui');

app.on('second-instance', () => {
  showMainWindow();
});

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  const logs = new LogService();
  const config = new ConfigService();
  await cleanupQceBeforeStartup(config, logs);
  const qceProcess = new QceProcessService(logs);
  const qceUpdater = new QceUpdateService(config, qceProcess, logs);
  const qceApi = new QceApiClient();
  const aiClient = new AiClient(logs);
  const summary = new SummaryService(aiClient, logs);
  const markdown = new MarkdownAppendService(logs);
  const history = new HistoryService();
  const manualSummaryHistory = new ManualSummaryHistoryService();
  const autoLaunch = new AutoLaunchService();
  const backupRunner = new BackupRunner(config, qceProcess, qceApi, summary, markdown, history, logs);
  const services = { config, qceProcess, qceUpdater, qceApi, backupRunner, aiClient, summary, markdown, history, manualSummaryHistory, autoLaunch, logs };
  qceProcessForQuit = qceProcess;
  logsForQuit = logs;
  configForQuit = config;

  registerIpcHandlers(services);
  mainWindow = createWindow((hidden || config.get().ui.startMinimized) && !openUi);
  wireEvents(mainWindow, services);
  createTray();
  logs.info('app', `App started: startup=${isStartup} hidden=${hidden} runDue=${runDue}`);

  if (config.get().qce.autoStartOnAppLaunch) {
    try {
      qceProcess.start(config.get().qce);
      logs.info('app', 'Auto-started QCE on app launch');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logs.error('app', `Auto-start QCE on app launch failed: ${message}`);
      if (!hidden) showMainWindow();
    }
  }

  runStartupPlansAfterRendererReady(config, backupRunner, logs);
});

function runStartupPlansAfterRendererReady(config: ConfigService, backupRunner: BackupRunner, logs: LogService): void {
  const runPlans = () => {
    void runStartupPlans(config, backupRunner, logs);
  };
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.webContents.isLoading()) {
    mainWindow.webContents.once('did-finish-load', runPlans);
  } else {
    runPlans();
  }
}

async function runStartupPlans(config: ConfigService, backupRunner: BackupRunner, logs: LogService): Promise<void> {
  const duePlans = getDueStartupPlans(config.get().backup.plans);
  if (duePlans.length === 0) {
    logs.info('app', 'No startup plans are enabled for automatic run');
    return;
  }

  logs.info('app', `Running ${duePlans.length} startup plan(s) after app launch`);
  showMainWindow();
  for (const plan of duePlans) {
    const results = await backupRunner.runStartupBackfill(plan.id, isStartup ? 'startup' : 'manual');
    if (results.some((result) => !result.ok)) showMainWindow();
  }
  if (isStartup && config.get().backup.exitAppAfterStartupSuccess) {
    await quitAppWithQce();
  }
}

async function cleanupQceBeforeStartup(config: ConfigService, logs: LogService): Promise<void> {
  const qceDir = config.get().qce.qceDir;
  if (!qceDir) return;
  try {
    const killed = await cleanupQceProcessTrees(qceDir, true);
    if (killed.length > 0) {
      logs.info('app', `Startup cleanup killed QCE/NapCat process trees: ${killed.join(', ')}`);
    } else {
      logs.info('app', 'Startup cleanup found no stale QCE/NapCat process trees');
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logs.error('app', `Startup cleanup failed: ${message}`);
  }
}

app.on('before-quit', (event) => {
  if (isQuitting) return;
  event.preventDefault();
  void quitAppWithQce();
});

app.on('window-all-closed', () => {
  if (isQuitting) app.quit();
});

function createWindow(startHidden: boolean): BrowserWindow {
  const iconPath = getIconPath();
  const window = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 980,
    minHeight: 640,
    show: !startHidden,
    icon: iconPath || undefined,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  window.setMenuBarVisibility(false);

  window.on('close', (event) => {
    if (isQuitting) return;
    event.preventDefault();
    window.hide();
  });

  window.on('closed', () => {
    if (mainWindow === window) mainWindow = undefined;
  });

  window.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedUrl) => {
    console.error(`Renderer failed to load ${validatedUrl}: ${errorCode} ${errorDescription}`);
  });

  window.webContents.on('render-process-gone', (_event, details) => {
    console.error(`Renderer process gone: ${details.reason}`);
  });

  window.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    console.log(`[renderer:${level}] ${message} (${sourceId}:${line})`);
  });

  const rendererUrl = process.env.ELECTRON_RENDERER_URL;
  if (rendererUrl) {
    window.loadURL(rendererUrl);
  } else {
    window.loadFile(join(__dirname, '../renderer/index.html'));
  }
  return window;
}

function createTray(): void {
  const iconPath = getIconPath();
  const image = iconPath ? nativeImage.createFromPath(iconPath) : nativeImage.createEmpty();
  tray = new Tray(image);
  tray.setToolTip('QCE AI Backup');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open', click: () => showMainWindow() },
      {
        label: 'Quit',
        click: () => {
          void quitAppWithQce();
        }
      }
    ])
  );
  tray.on('double-click', () => showMainWindow());
}

function getIconPath(): string {
  const candidates = [
    join(process.resourcesPath, 'assets', 'icon.ico'),
    join(process.cwd(), 'assets', 'icon.ico'),
    join(__dirname, '../../assets/icon.ico')
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? '';
}

function showMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.show();
  mainWindow.focus();
}

async function quitAppWithQce(): Promise<void> {
  if (isQuitCleanupRunning) return;
  isQuitCleanupRunning = true;
  try {
    if (qceProcessForQuit) {
      const forceKillQceOnShutdown = configForQuit?.get().qce.forceKillQceOnShutdown ?? true;
      if (forceKillQceOnShutdown) {
        logsForQuit?.info('app', 'Exiting app, stopping QCE/NapCat process tree');
        await qceProcessForQuit.stop(true);
      } else {
        logsForQuit?.info('app', 'Exiting app without stopping QCE/NapCat because forceKillQceOnShutdown=false');
        qceProcessForQuit.releaseForAppExit();
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logsForQuit?.error('app', `Failed to stop QCE/NapCat while quitting: ${message}`);
  } finally {
    isQuitting = true;
    app.quit();
  }
}
