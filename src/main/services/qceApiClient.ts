import axios, { type AxiosInstance } from 'axios';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { tmpdir } from 'node:os';
import type { QceConfig } from '../types/config';
import type {
  CreateExportTaskInput,
  CreateExportTaskResult,
  QceDiagnosis,
  QceGroup,
  QceHealth,
  QceTask
} from '../types/qce';
import { readQceMajorVersion } from './qceVersion';

export class QceApiClient {
  webUiUrl(config: QceConfig): string {
    const path = (readQceMajorVersion(config.qceDir) ?? 0) >= 6 ? '/qce' : '/qce-v4-tool';
    return new URL(path, config.baseUrl).toString();
  }

  private client(config: QceConfig, token?: string): AxiosInstance {
    return axios.create({
      baseURL: config.baseUrl,
      timeout: 15000,
      headers: token
        ? {
            Authorization: `Bearer ${token}`,
            'X-Access-Token': token,
            'Content-Type': 'application/json'
          }
        : undefined
    });
  }

  async health(config: QceConfig): Promise<QceHealth> {
    try {
      const response = await this.client(config).get('/health');
      const raw = response.data;
      const data = asRecord(unwrapSuccessData(raw));
      const online = Boolean(data.online);
      return {
        ok: true,
        online,
        status: stringOrUndefined(data.status),
        error: online ? undefined : 'QCE API 已启动，但 QQ 账号还未在线',
        raw
      };
    } catch (error) {
      return { ok: false, online: false, error: errorToMessage(error) };
    }
  }

  readAccessToken(config: QceConfig): string {
    const path = expandEnv(config.securityJsonPath);
    if (!existsSync(path)) throw new Error(`security.json 不存在：${path}`);
    const raw = JSON.parse(readFileSync(path, 'utf8')) as { accessToken?: string };
    if (!raw.accessToken) throw new Error('security.json 中没有 accessToken');
    return raw.accessToken;
  }

  async listGroups(config: QceConfig): Promise<QceGroup[]> {
    const token = this.readAccessToken(config);
    const response = await this.client(config, token).get('/api/groups?page=1&limit=999&forceRefresh=false');
    const rows = unwrapArray(unwrapSuccessData(response.data));
    return rows.map((row) => ({
      groupCode: String(row.groupCode ?? row.code ?? row.uin ?? row.peerUid ?? ''),
      groupName: String(row.groupName ?? row.name ?? row.remark ?? ''),
      memberCount: asNumber(row.memberCount ?? row.member_count),
      raw: row
    }));
  }

  async createExportTask(config: QceConfig, input: CreateExportTaskInput): Promise<CreateExportTaskResult> {
    const token = this.readAccessToken(config);
    const response = await this.client(config, token).post('/api/messages/export', input);
    const raw = response.data;
    const data = asRecord(unwrapSuccessData(raw));
    const taskId = String(data.taskId ?? data.id ?? asRecord(data.task).id ?? '');
    if (!taskId) throw new Error('QCE 没有返回导出任务 ID');
    return {
      taskId,
      downloadUrl: stringOrUndefined(data.downloadUrl ?? data.url),
      filePath: stringOrUndefined(data.filePath ?? data.path),
      raw
    };
  }

  async getTask(config: QceConfig, taskId: string): Promise<QceTask> {
    const token = this.readAccessToken(config);
    const response = await this.client(config, token).get(`/api/tasks/${encodeURIComponent(taskId)}`);
    return normalizeTask(taskId, response.data);
  }

  async cancelTask(config: QceConfig, taskId: string): Promise<void> {
    const token = this.readAccessToken(config);
    await this.client(config, token).post(`/api/tasks/${encodeURIComponent(taskId)}/cancel`);
  }

  async downloadExport(config: QceConfig, task: QceTask | CreateExportTaskResult): Promise<string> {
    if (task.filePath && existsSync(task.filePath)) return task.filePath;
    if (!task.downloadUrl) throw new Error('无法定位导出文件');
    const token = this.readAccessToken(config);
    const url = task.downloadUrl.startsWith('http') ? task.downloadUrl : `${config.baseUrl}${task.downloadUrl}`;
    const response = await this.client(config, token).get(url, { responseType: 'arraybuffer' });
    const guessedName = basename(new URL(url).pathname) || `qce-export-${Date.now()}.json`;
    const path = join(tmpdir(), guessedName);
    writeFileSync(path, response.data);
    return path;
  }

  async diagnose(config: QceConfig): Promise<QceDiagnosis> {
    const items: QceDiagnosis['items'] = [];
    const hints: string[] = [];

    const qceDirOk = Boolean(config.qceDir && existsSync(config.qceDir));
    items.push({
      name: 'QCE Shell 目录',
      ok: qceDirOk,
      detail: qceDirOk ? config.qceDir : `目录不存在或未配置：${config.qceDir || '(空)'}`
    });

    const pluginNames = ['napcat-plugin-qce', 'qq-chat-exporter'];
    const pluginDir = config.qceDir
      ? pluginNames.map((name) => join(config.qceDir, 'plugins', name)).find((path) => existsSync(path)) || ''
      : '';
    const pluginOk = Boolean(pluginDir && existsSync(pluginDir));
    items.push({
      name: 'QCE 插件目录',
      ok: pluginOk,
      detail: pluginOk ? pluginDir : `未找到插件目录：${config.qceDir ? join(config.qceDir, 'plugins') : '(空)'}`
    });

    const pluginsJsonPath = config.qceDir ? join(config.qceDir, 'config', 'plugins.json') : '';
    let pluginEnabled = false;
    if (pluginsJsonPath && existsSync(pluginsJsonPath)) {
      try {
        const pluginsJson = JSON.parse(readFileSync(pluginsJsonPath, 'utf8')) as Record<string, unknown>;
        pluginEnabled = pluginNames.some((name) => pluginsJson[name] === true);
      } catch {
        pluginEnabled = false;
      }
    }
    items.push({
      name: 'plugins.json 启用状态',
      ok: pluginEnabled,
      detail: pluginEnabled ? 'napcat-plugin-qce=true' : `未启用或无法读取：${pluginsJsonPath || '(空)'}`
    });

    try {
      const token = this.readAccessToken(config);
      items.push({ name: 'security.json token', ok: true, detail: `${token.slice(0, 4)}****${token.slice(-4)}` });
    } catch (error) {
      items.push({ name: 'security.json token', ok: false, detail: errorToMessage(error) });
    }

    const health = await this.health(config);
    items.push({
      name: 'QCE API /health',
      ok: health.ok,
      detail: health.ok
        ? `API 可访问，QQ 在线状态：${health.online ? 'online' : 'offline'}`
        : `API 不可访问：${health.error ?? '未知错误'}`
    });

    if (health.ok) {
      try {
        const response = await this.client(config).get('/security-status');
        const data = asRecord(unwrapSuccessData(response.data));
        items.push({
          name: 'QCE API /security-status',
          ok: true,
          detail: `需要认证：${String(data.requiresAuth ?? true)}，配置：${String(data.configPath ?? '')}`
        });
      } catch (error) {
        items.push({ name: 'QCE API /security-status', ok: false, detail: errorToMessage(error) });
      }
    }

    if (!health.ok) {
      hints.push('40653 端口不可访问时，说明 QCE 导出 API 没启动。NapCat WebUI 的 6099 不是导出 API。');
      hints.push(`请在 QCE/NapCat 控制台里确认 napcat-plugin-qce 插件加载成功，并能打开 ${this.webUiUrl(config)}。`);
    } else if (!health.online) {
      hints.push('API 已启动但 QQ 未在线，请先完成 QQ 登录并等待 /health 返回 online=true。');
    }
    if (!pluginOk || !pluginEnabled) {
      hints.push('插件目录或 plugins.json 异常会导致 40653 不监听，请确认 NapCat-QCE 完整模式安装正确。');
    }

    return { ok: items.every((item) => item.ok), items, hints };
  }
}

function expandEnv(path: string): string {
  return path.replace(/%([^%]+)%/g, (_, name: string) => process.env[name] ?? '');
}

function unwrapArray(raw: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(raw)) return raw as Array<Record<string, unknown>>;
  const candidate = asRecord(raw);
  if (Array.isArray(candidate.data)) return candidate.data as Array<Record<string, unknown>>;
  if (Array.isArray(candidate.groups)) return candidate.groups as Array<Record<string, unknown>>;
  if (Array.isArray(candidate.tasks)) return candidate.tasks as Array<Record<string, unknown>>;
  const list = asRecord(candidate.data).list ?? asRecord(candidate.data).records;
  return Array.isArray(list) ? (list as Array<Record<string, unknown>>) : [];
}

function normalizeTask(taskId: string, raw: unknown): QceTask {
  const row = asRecord(unwrapSuccessData(raw));
  const statusText = String(row.status ?? row.state ?? '').toLowerCase();
  const status =
    ['success', 'done', 'finished', 'completed'].includes(statusText) ? 'success' :
    ['failed', 'error', 'cancelled', 'canceled'].includes(statusText) ? 'failed' :
    ['pending', 'waiting'].includes(statusText) ? 'pending' :
    ['running', 'processing', 'exporting', 'paused'].includes(statusText) ? 'running' :
    'unknown';
  return {
    taskId: String(row.taskId ?? row.id ?? taskId),
    status,
    progress: asNumber(row.progress),
    downloadUrl: stringOrUndefined(row.downloadUrl ?? row.url),
    filePath: stringOrUndefined(row.filePath ?? row.path),
    error: stringOrUndefined(row.error ?? row.message ?? asRecord(row.error).message),
    raw
  };
}

function unwrapSuccessData(raw: unknown): unknown {
  const row = asRecord(raw);
  if (row.success === false) throw new Error(formatQceError(row));
  return Object.prototype.hasOwnProperty.call(row, 'data') ? row.data : raw;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function formatQceError(raw: Record<string, unknown>): string {
  const error = asRecord(raw.error);
  const context = asRecord(error.context);
  const code = stringOrUndefined(raw.code ?? error.code ?? context.code);
  const message = stringOrUndefined(raw.message ?? error.message) ?? JSON.stringify(raw);
  return code ? `${code}: ${message}` : message;
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function errorToMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const code = error.code ? `${error.code}: ` : '';
    const status = error.response?.status ? `HTTP ${error.response.status}: ` : '';
    const serverMessage = error.response?.data ? formatQceError(asRecord(error.response.data)) : '';
    return `${code}${status}${serverMessage || error.message}`;
  }
  return error instanceof Error ? error.message : String(error);
}
