import { session } from 'electron';
import { execFile } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs';
import { basename, dirname, isAbsolute, join, normalize, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import type { QceConfig } from '../types/config';
import type { QceUpdateCheckResult, QceUpdateResult } from '../types/qce';
import type { ConfigService } from './configService';
import type { LogService } from './logService';
import type { QceProcessService } from './qceProcessService';
import { cleanupQceProcessTrees } from './processKillService';
import { readQceVersion } from './qceVersion';

const execFileAsync = promisify(execFile);
const RELEASE_API_URL = 'https://api.github.com/repos/shuakami/qq-chat-exporter/releases/latest';
const WINDOWS_SHELL_ASSET = /^NapCat-QCE-Windows-x64-v[0-9A-Za-z][0-9A-Za-z._-]*\.zip$/i;
const UPDATE_USER_AGENT = 'QCE-AI-Backup-Updater';

type GithubRelease = {
  tag_name: string;
  assets: GithubAsset[];
};

type GithubAsset = {
  name: string;
  size: number;
  browser_download_url: string;
};

export class QceUpdateService {
  private pending?: Promise<QceUpdateResult>;
  private checkPending?: Promise<QceUpdateCheckResult>;

  constructor(
    private readonly config: ConfigService,
    private readonly qceProcess: QceProcessService,
    private readonly logs: LogService
  ) {}

  checkLatest(): Promise<QceUpdateCheckResult> {
    if (this.checkPending) return this.checkPending;
    this.checkPending = this.performCheck().finally(() => {
      this.checkPending = undefined;
    });
    return this.checkPending;
  }

  updateLatest(): Promise<QceUpdateResult> {
    if (this.pending) return this.pending;
    this.pending = this.performUpdate().finally(() => {
      this.pending = undefined;
    });
    return this.pending;
  }

  private async performCheck(): Promise<QceUpdateCheckResult> {
    const qceConfig = this.config.get().qce;
    const qceDir = qceConfig.qceDir;
    if (!qceDir) {
      return { ok: true, updateAvailable: false, message: 'QCE 目录未配置，已跳过更新检查' };
    }

    try {
      const proxyUrl = resolveUpdateProxy(qceConfig.updateProxyUrl);
      this.logs.info('qce', `${describeUpdateNetwork(proxyUrl)}自动检查 QCE 更新`);
      const updateSession = await createUpdateSession(proxyUrl);
      const release = await fetchLatestRelease(updateSession);
      findWindowsShellAsset(release);

      const currentVersion = readQceVersion(qceDir);
      if (!currentVersion) throw new Error('无法识别当前 QCE 版本');
      const latestVersion = release.tag_name.replace(/^v/i, '');
      const updateAvailable = currentVersion !== latestVersion;
      const message = updateAvailable
        ? `发现 QCE 新版本 ${release.tag_name}，当前版本 v${currentVersion}`
        : `QCE 当前已是最新版 ${release.tag_name}`;
      this.logs.info('qce', message);
      return { ok: true, updateAvailable, message, currentVersion, latestVersion };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logs.warn('qce', `自动检查 QCE 更新失败：${message}`);
      return { ok: false, updateAvailable: false, message, error: message };
    }
  }

  private async performUpdate(): Promise<QceUpdateResult> {
    const previousConfig = this.config.get().qce;
    const previousQceDir = previousConfig.qceDir;
    let stagingDir = '';
    let shouldRestartQce = this.qceProcess.running;
    let configSwitched = false;

    try {
      const proxyUrl = resolveUpdateProxy(previousConfig.updateProxyUrl);
      this.logs.info('qce', `${describeUpdateNetwork(proxyUrl)}检查 QCE 更新`);
      const updateSession = await createUpdateSession(proxyUrl);
      const release = await fetchLatestRelease(updateSession);
      const asset = findWindowsShellAsset(release);

      const currentVersion = readQceVersion(previousQceDir);
      const latestVersion = release.tag_name.replace(/^v/i, '');
      if (currentVersion === latestVersion && isQceRoot(previousQceDir)) {
        return {
          ok: true,
          message: `当前已是最新版 ${release.tag_name}`,
          version: release.tag_name,
          qceDir: previousQceDir,
          previousQceDir,
          alreadyLatest: true
        };
      }

      const installBase = resolveInstallBase(previousQceDir);
      mkdirSync(installBase, { recursive: true });
      const targetName = asset.name.replace(/\.zip$/i, '');
      let targetDir = join(installBase, targetName);
      const existingQceDir = existsSync(targetDir) ? findQceRoot(targetDir) : undefined;

      if (existingQceDir && readQceVersion(existingQceDir) === latestVersion) {
        this.logs.info('qce', `发现已下载的 QCE ${release.tag_name}，直接完成配置迁移`);
        const stoppedOldQce = await this.stopOldQce(previousQceDir);
        shouldRestartQce ||= stoppedOldQce;
        migrateRuntimeConfig(previousQceDir, existingQceDir);
        const nextConfig = switchQceDirectory(this.config, previousConfig, existingQceDir);
        configSwitched = true;
        if (shouldRestartQce) this.qceProcess.start(nextConfig);
        return {
          ok: true,
          message: `已切换到 QCE ${release.tag_name}`,
          version: release.tag_name,
          qceDir: existingQceDir,
          previousQceDir
        };
      }

      if (existsSync(targetDir)) targetDir = `${targetDir}-${Date.now()}`;
      stagingDir = join(installBase, `.qce-update-${process.pid}-${Date.now()}`);
      const archivePath = join(stagingDir, asset.name);
      const extractDir = join(stagingDir, 'extracted');
      mkdirSync(extractDir, { recursive: true });

      this.logs.info('qce', `开始下载 QCE ${release.tag_name}：${asset.name}`);
      await downloadAsset(updateSession, asset, archivePath);
      this.logs.info('qce', `QCE 下载完成，开始解压：${asset.size} bytes`);
      await expandArchive(archivePath, extractDir);

      const extractedQceDir = findQceRoot(extractDir);
      if (!extractedQceDir) throw new Error('QCE 压缩包中未找到 launcher-user.bat');
      const extractedVersion = readQceVersion(extractedQceDir);
      if (extractedVersion !== latestVersion) {
        throw new Error(`QCE 压缩包版本不一致：预期 ${latestVersion}，实际 ${extractedVersion || '未知'}`);
      }
      const qceRootRelativePath = relative(extractDir, extractedQceDir);
      if (qceRootRelativePath.startsWith('..') || isAbsolute(qceRootRelativePath)) {
        throw new Error('QCE 解压目录校验失败');
      }

      const stoppedOldQce = await this.stopOldQce(previousQceDir);
      shouldRestartQce ||= stoppedOldQce;
      migrateRuntimeConfig(previousQceDir, extractedQceDir);
      renameSync(extractDir, targetDir);

      const nextQceDir = resolve(targetDir, qceRootRelativePath);
      if (!isQceRoot(nextQceDir)) throw new Error('QCE 新目录落盘后校验失败');
      const nextConfig = switchQceDirectory(this.config, previousConfig, nextQceDir);
      configSwitched = true;
      if (shouldRestartQce) this.qceProcess.start(nextConfig);

      this.logs.info('qce', `QCE 已更新到 ${release.tag_name}：${nextQceDir}`);
      return {
        ok: true,
        message: `已更新到 ${release.tag_name}，目录已自动切换`,
        version: release.tag_name,
        qceDir: nextQceDir,
        previousQceDir
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logs.error('qce', `QCE 更新失败：${message}`);
      if (configSwitched) this.config.update({ qce: previousConfig });
      if (shouldRestartQce && !this.qceProcess.running) {
        try {
          this.qceProcess.start(previousConfig);
          this.logs.info('qce', 'QCE 更新失败，已恢复启动旧版本');
        } catch (restartError) {
          const restartMessage = restartError instanceof Error ? restartError.message : String(restartError);
          this.logs.error('qce', `恢复旧版 QCE 失败：${restartMessage}`);
        }
      }
      return { ok: false, message, error: message, previousQceDir, qceDir: previousQceDir };
    } finally {
      removeStagingDirectory(stagingDir);
    }
  }

  private async stopOldQce(qceDir: string): Promise<boolean> {
    const wasOwned = this.qceProcess.running;
    if (wasOwned) await this.qceProcess.stop(true);
    const killed = qceDir && existsSync(qceDir) ? await cleanupQceProcessTrees(qceDir, true) : [];
    return wasOwned || killed.length > 0;
  }
}

async function createUpdateSession(proxyUrl: string): Promise<Electron.Session> {
  const updateSession = session.fromPartition('qce-updater', { cache: false });
  if (proxyUrl) {
    await updateSession.setProxy({
      mode: 'fixed_servers',
      proxyRules: proxyUrl,
      proxyBypassRules: 'localhost,127.0.0.1'
    });
  } else {
    await updateSession.setProxy({ mode: 'system' });
  }
  await updateSession.closeAllConnections();
  return updateSession;
}

function resolveUpdateProxy(configuredProxy: string): string {
  return (
    configuredProxy?.trim() ||
    process.env.HTTPS_PROXY?.trim() ||
    process.env.https_proxy?.trim() ||
    process.env.HTTP_PROXY?.trim() ||
    process.env.http_proxy?.trim() ||
    ''
  );
}

function describeUpdateNetwork(proxyUrl: string): string {
  if (!proxyUrl) return '通过系统网络设置';
  try {
    const parsed = new URL(proxyUrl);
    parsed.username = '';
    parsed.password = '';
    return `通过代理 ${parsed.toString()}`;
  } catch {
    return '通过已配置代理';
  }
}

function findWindowsShellAsset(release: GithubRelease): GithubAsset {
  const asset = release.assets.find((item) => WINDOWS_SHELL_ASSET.test(item.name));
  if (!asset) throw new Error(`QCE ${release.tag_name} 未提供 Windows x64 Shell ZIP`);
  return asset;
}

async function fetchLatestRelease(updateSession: Electron.Session): Promise<GithubRelease> {
  const response = await fetchWithTimeout(updateSession, RELEASE_API_URL, 30_000);
  if (!response.ok) throw new Error(`GitHub Releases API 返回 ${response.status}`);
  const value = (await response.json()) as Partial<GithubRelease>;
  if (!value.tag_name || !Array.isArray(value.assets)) throw new Error('GitHub Releases API 返回格式异常');
  return value as GithubRelease;
}

async function downloadAsset(updateSession: Electron.Session, asset: GithubAsset, destination: string): Promise<void> {
  validateAsset(asset);
  const response = await fetchWithTimeout(updateSession, asset.browser_download_url, 15 * 60_000);
  if (!response.ok) throw new Error(`QCE 下载返回 ${response.status}`);
  const data = Buffer.from(await response.arrayBuffer());
  if (data.length !== asset.size) {
    throw new Error(`QCE 下载大小不一致：预期 ${asset.size}，实际 ${data.length}`);
  }
  writeFileSync(destination, data);
  const savedSize = statSync(destination).size;
  if (savedSize !== asset.size) throw new Error(`QCE 文件写入不完整：${savedSize}/${asset.size}`);
}

function validateAsset(asset: GithubAsset): void {
  const url = new URL(asset.browser_download_url);
  if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== 'github.com') {
    throw new Error('QCE 下载地址不是受信任的 GitHub HTTPS 地址');
  }
  if (!Number.isSafeInteger(asset.size) || asset.size <= 0 || asset.size > 1024 * 1024 * 1024) {
    throw new Error(`QCE 发布资产大小异常：${asset.size}`);
  }
}

async function fetchWithTimeout(updateSession: Electron.Session, url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await updateSession.fetch(url, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': UPDATE_USER_AGENT },
      redirect: 'follow',
      signal: controller.signal
    });
  } catch (error) {
    if (controller.signal.aborted) throw new Error(`连接超时：${url}`);
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`无法连接 GitHub：${message}`);
  } finally {
    clearTimeout(timeout);
  }
}

async function expandArchive(archivePath: string, destination: string): Promise<void> {
  const script = [
    "$ErrorActionPreference = 'Stop'",
    'Expand-Archive -LiteralPath $env:QCE_UPDATE_ARCHIVE -DestinationPath $env:QCE_UPDATE_DESTINATION -Force'
  ].join('; ');
  await execFileAsync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], {
    windowsHide: true,
    env: {
      ...process.env,
      QCE_UPDATE_ARCHIVE: archivePath,
      QCE_UPDATE_DESTINATION: destination
    },
    maxBuffer: 1024 * 1024
  });
}

function resolveInstallBase(qceDir: string): string {
  const current = qceDir ? resolve(qceDir) : '';
  if (!current) return join(process.env.LOCALAPPDATA || process.cwd(), 'QCE AI Backup', 'qce');
  const currentName = basename(current);
  const parent = dirname(current);
  if (/^NapCat-QCE-Windows-x64$/i.test(currentName) && /^NapCat-QCE-Windows-x64-v/i.test(basename(parent))) {
    return dirname(parent);
  }
  return parent;
}

function findQceRoot(root: string, depth = 0): string | undefined {
  if (isQceRoot(root)) return root;
  if (depth >= 3 || !existsSync(root)) return undefined;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    const found = findQceRoot(join(root, entry.name), depth + 1);
    if (found) return found;
  }
  return undefined;
}

function isQceRoot(pathValue: string): boolean {
  return Boolean(pathValue && existsSync(join(pathValue, 'launcher-user.bat')));
}

function migrateRuntimeConfig(previousQceDir: string, nextQceDir: string): void {
  if (!previousQceDir || isSamePath(previousQceDir, nextQceDir)) return;
  const oldConfigDir = join(previousQceDir, 'config');
  const newConfigDir = join(nextQceDir, 'config');
  if (!existsSync(oldConfigDir)) return;
  mkdirSync(newConfigDir, { recursive: true });
  copyMissingTree(oldConfigDir, newConfigDir);
}

function copyMissingTree(sourceDir: string, targetDir: string): void {
  for (const entry of readdirSync(sourceDir, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    const source = join(sourceDir, entry.name);
    const target = join(targetDir, entry.name);
    if (entry.isDirectory()) {
      mkdirSync(target, { recursive: true });
      copyMissingTree(source, target);
    } else if (entry.isFile() && !existsSync(target)) {
      copyFileSync(source, target);
    }
  }
}

function switchQceDirectory(config: ConfigService, previous: QceConfig, nextQceDir: string): QceConfig {
  const next = config.update({
    qce: {
      ...previous,
      qceDir: nextQceDir,
      launcherBat: join(nextQceDir, 'launcher-user.bat'),
      securityJsonPath: remapChildPath(previous.securityJsonPath, previous.qceDir, nextQceDir)
    }
  });
  return next.qce;
}

function remapChildPath(pathValue: string, oldRoot: string, newRoot: string): string {
  if (!pathValue || !oldRoot) return pathValue;
  const child = relative(resolve(oldRoot), resolve(pathValue));
  if (child.startsWith('..') || isAbsolute(child)) return pathValue;
  return resolve(newRoot, child);
}

function isSamePath(left: string, right: string): boolean {
  return normalize(resolve(left)).toLowerCase() === normalize(resolve(right)).toLowerCase();
}

function removeStagingDirectory(stagingDir: string): void {
  if (!stagingDir) return;
  const name = basename(stagingDir);
  if (!name.startsWith('.qce-update-')) return;
  try {
    rmSync(stagingDir, { recursive: true, force: true });
  } catch {
    // A failed update remains recoverable; stale staging files can be removed next time.
  }
}
