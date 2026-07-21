import { existsSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import Store from 'electron-store';
import { z } from 'zod';
import { defaultAppConfig, defaultOpenAiCompatibleConfig, type AiConfig, type AiProviderConfig, type AppConfig, type BackupPlan, type BackupTarget } from '../types/config';

const appConfigSchema = z.object({}).passthrough();

export class ConfigService {
  private readonly store = new Store<AppConfig>({
    name: 'config',
    defaults: defaultAppConfig
  });

  get(): AppConfig {
    const value = this.store.store as AppConfig;
    appConfigSchema.parse(value);
    return normalizeConfig(value);
  }

  update(patch: Partial<AppConfig>): AppConfig {
    const next = deepMerge(this.get(), patch) as AppConfig;
    this.store.store = normalizeConfig(next);
    return this.get();
  }

  validateQcePath(qceDir: string): { ok: boolean; message: string } {
    if (!qceDir) return { ok: false, message: 'QCE Shell 目录为空' };
    if (!existsSync(qceDir)) return { ok: false, message: 'QCE Shell 目录不存在' };
    const launcher = join(qceDir, 'launcher-user.bat');
    if (!existsSync(launcher)) return { ok: false, message: '目录下没有 launcher-user.bat' };
    return { ok: true, message: 'QCE Shell 路径可用' };
  }
}

function normalizeConfig(config: AppConfig): AppConfig {
  const qceDir = config.qce.qceDir ?? '';
  const launcherBat = config.qce.launcherBat || (qceDir ? join(qceDir, 'launcher-user.bat') : '');
  return {
    ...defaultAppConfig,
    ...config,
    qce: {
      ...defaultAppConfig.qce,
      ...config.qce,
      launcherBat
    },
    backup: {
      ...defaultAppConfig.backup,
      ...config.backup,
      plans: (config.backup?.plans ?? []).map(normalizeBackupPlan)
    },
    ai: normalizeAiConfig(config.ai),
    summary: {
      ...defaultAppConfig.summary,
      ...config.summary,
      chunking: {
        ...defaultAppConfig.summary.chunking,
        ...config.summary?.chunking
      },
      prompts: {
        ...defaultAppConfig.summary.prompts,
        ...config.summary?.prompts
      },
      output: {
        ...defaultAppConfig.summary.output,
        ...config.summary?.output
      },
      privacy: {
        ...defaultAppConfig.summary.privacy,
        ...config.summary?.privacy
      }
    },
    markdown: normalizeMarkdownConfig(config.markdown),
    ui: {
      ...defaultAppConfig.ui,
      ...config.ui
    },
    advanced: {
      ...defaultAppConfig.advanced,
      ...config.advanced
    }
  };
}

function normalizeMarkdownConfig(config: AppConfig['markdown']): AppConfig['markdown'] {
  const markdown = {
    ...defaultAppConfig.markdown,
    ...config
  };
  return {
    ...markdown,
    summaryDir: markdown.summaryDir || directoryFromLegacyMarkdownPath(markdown.markdownPath)
  };
}

function directoryFromLegacyMarkdownPath(pathValue: string): string {
  const value = (pathValue || '').trim();
  if (!value) return '';
  return extname(value) ? dirname(value) : value;
}

function normalizeBackupPlan(plan: BackupPlan): BackupPlan {
  const legacySchedule = plan.schedule as BackupPlan['schedule'] | { type?: string; autoRunOnAppLaunch?: boolean; delaySeconds?: number };
  const backfillDays = Number((legacySchedule as { backfillDays?: number }).backfillDays);
  const targets = normalizeBackupTargets(plan.targets?.length ? plan.targets : [plan.target]);
  return {
    ...plan,
    target: targets[0] ?? plan.target,
    targets,
    schedule: {
      type: 'startup',
      autoRunOnAppLaunch: legacySchedule.autoRunOnAppLaunch ?? true,
      delaySeconds: Number(legacySchedule.delaySeconds) || 0,
      backfillDays: Number.isFinite(backfillDays) && backfillDays > 0 ? backfillDays : 7
    }
  };
}

function normalizeBackupTargets(targets: BackupPlan['targets']): BackupTarget[] {
  const normalized: BackupTarget[] = [];
  const seen = new Set<string>();
  for (const target of targets ?? []) {
    const groupCode = String(target?.groupCode ?? '').trim();
    const groupName = String(target?.groupName ?? '').trim();
    if (!groupCode && !groupName) continue;
    const key = groupCode || groupName;
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push({ type: 'group', groupCode, groupName });
  }
  return normalized.length ? normalized : [{ type: 'group', groupCode: '', groupName: '' }];
}

function normalizeAiConfig(config: AiConfig): AiConfig {
  const openaiCompatible = {
    ...defaultOpenAiCompatibleConfig,
    ...(config?.openaiCompatible ?? {})
  };
  const legacyPrimary: AiProviderConfig = {
    id: 'primary',
    name: '主 AI',
    enabled: true,
    role: 'primary',
    providerType: config?.providerType ?? 'openaiCompatible',
    openaiCompatible
  };
  const rawProviders = config?.providers?.length ? config.providers : [legacyPrimary];
  const providers = rawProviders.map((provider, index) => ({
    ...provider,
    id: provider.id || (index === 0 ? 'primary' : `fallback-${index}`),
    name: provider.name || (index === 0 ? '主 AI' : `备用 AI ${index}`),
    enabled: provider.enabled ?? true,
    role: index === 0 ? 'primary' as const : provider.role === 'primary' ? 'fallback' as const : provider.role,
    providerType: provider.providerType ?? 'openaiCompatible',
    openaiCompatible: {
      ...defaultOpenAiCompatibleConfig,
      ...(provider.openaiCompatible ?? (index === 0 ? openaiCompatible : {}))
    }
  }));

  return {
    ...defaultAppConfig.ai,
    ...config,
    providerType: providers[0]?.providerType ?? 'openaiCompatible',
    openaiCompatible: providers[0]?.openaiCompatible ?? openaiCompatible,
    providers
  };
}

function deepMerge<T>(base: T, patch: Partial<T>): T {
  if (!patch || typeof patch !== 'object') return base;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [key, value] of Object.entries(patch)) {
    const oldValue = out[key];
    out[key] =
      value && oldValue && typeof value === 'object' && typeof oldValue === 'object' && !Array.isArray(value)
        ? deepMerge(oldValue, value)
        : value;
  }
  return out as T;
}
