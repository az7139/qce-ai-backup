import { contextBridge, ipcRenderer } from 'electron';

const on = (channel: string, callback: (payload: unknown) => void) => {
  const listener = (_event: Electron.IpcRendererEvent, payload: unknown) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

contextBridge.exposeInMainWorld('qceAiBackup', {
  config: {
    get: () => ipcRenderer.invoke('config:get'),
    update: (patch: unknown) => ipcRenderer.invoke('config:update', patch)
  },
  qce: {
    validatePath: (qceDir: string) => ipcRenderer.invoke('qce:validatePath', qceDir),
    start: () => ipcRenderer.invoke('qce:start'),
    stop: () => ipcRenderer.invoke('qce:stop'),
    checkUpdate: () => ipcRenderer.invoke('qce:checkUpdate'),
    update: () => ipcRenderer.invoke('qce:update'),
    health: () => ipcRenderer.invoke('qce:health'),
    diagnose: () => ipcRenderer.invoke('qce:diagnose'),
    readTokenPreview: () => ipcRenderer.invoke('qce:readTokenPreview'),
    listGroups: () => ipcRenderer.invoke('qce:listGroups'),
    openWebUi: () => ipcRenderer.invoke('qce:openWebUi')
  },
  backup: {
    runPlan: (planId: string) => ipcRenderer.invoke('backup:runPlan', planId),
    runStartupBackfill: (planId: string) => ipcRenderer.invoke('backup:runStartupBackfill', planId),
    testExport: (planId: string) => ipcRenderer.invoke('backup:testExport', planId),
    listHistory: () => ipcRenderer.invoke('backup:listHistory')
  },
  ai: {
    testConnection: (providerId?: string, config?: unknown) => ipcRenderer.invoke('ai:testConnection', providerId, config),
    testSummaryWithText: (text: string) => ipcRenderer.invoke('ai:testSummaryWithText', text)
  },
  summary: {
    runManual: (input: unknown) => ipcRenderer.invoke('summary:runManual', input),
    listManualHistory: () => ipcRenderer.invoke('summary:listManualHistory'),
    onManualProgress: (callback: (event: unknown) => void) => on('summary:manualProgress', callback)
  },
  markdown: {
    testWrite: (input: unknown) => ipcRenderer.invoke('markdown:testWrite', input),
    openFile: (path: string) => ipcRenderer.invoke('markdown:openFile', path),
    openDir: (path: string) => ipcRenderer.invoke('markdown:openDir', path)
  },
  autoLaunch: {
    getStatus: () => ipcRenderer.invoke('autoLaunch:getStatus'),
    enable: () => ipcRenderer.invoke('autoLaunch:enable'),
    disable: () => ipcRenderer.invoke('autoLaunch:disable')
  },
  logs: {
    getRecent: () => ipcRenderer.invoke('logs:getRecent'),
    clear: () => ipcRenderer.invoke('logs:clear'),
    openDir: () => ipcRenderer.invoke('logs:openDir'),
    onLine: (callback: (line: string) => void) => on('logs:line', (payload) => callback(String(payload)))
  },
  events: {
    onAppStatus: (callback: (status: string) => void) => on('app:status', (payload) => callback(String(payload))),
    onQceOutput: (callback: (line: string) => void) => on('qce:output', (payload) => callback(String(payload))),
    onBackupProgress: (callback: (event: unknown) => void) => on('backup:progress', callback)
  }
});
