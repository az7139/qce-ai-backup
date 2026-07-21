import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { LogService } from './logService';
import { readQceMajorVersion } from './qceVersion';

const FIRST_PAGE_ORIGINAL =
  'return await this.core.apis.MsgApi.getAioFirstViewLatestMsgs(peer, this.config.batchSize);';
const FIRST_PAGE_PATCHED =
  'return await this.core.apis.MsgApi.getAioFirstViewLatestMsgs(peer, 1); // qce-ai-backup: stable history cursor';
const FIRST_PAGE_LOG_ORIGINAL = 'getAioFirstViewLatestMsgs API, count=${this.config.batchSize}';
const FIRST_PAGE_LOG_PATCHED = 'getAioFirstViewLatestMsgs API, count=1';
const EARLY_STOP_ORIGINAL = 'earliestMsgTime < filter.startTime) {';
const EARLY_STOP_TS_EXPRESSION = 'earliestMsgTime < filter.startTime';
const EARLY_STOP_MARKER = 'qce-ai-backup: stop only when the whole page is before the window';
const EARLY_STOP_PATCHED_V1 = `messages.every((msg) => {
                const rawTime = parseInt(msg.msgTime);
                const msgTime = rawTime > 1000000000 && rawTime < 10000000000 ? rawTime * 1000 : rawTime;
                return Number.isFinite(msgTime) && msgTime < filter.startTime;
            })) { // qce-ai-backup: stop only when the whole page is before the window`;
const EARLY_STOP_PATCHED = `messages.every((msg) => {
                const rawTime = parseInt(msg.msgTime);
                const msgTime = rawTime > 1000000000 && rawTime < 10000000000 ? rawTime * 1000 : rawTime;
                return Number.isFinite(msgTime) && msgTime < Number(filter.startTime);
            })) { // qce-ai-backup: stop only when the whole page is before the window`;
const LEGACY_WRONG_EARLY_STOP = `result.${EARLY_STOP_PATCHED}`;
const LEGACY_WRONG_EARLY_STOP_V1 = `result.${EARLY_STOP_PATCHED_V1}`;
const LEGACY_OUTER_EARLY_STOP = `result.${EARLY_STOP_ORIGINAL}`;
const RUST_BRIDGE_ARGS_LINE = '        const args = Array.isArray(params) ? params : [params];';
const RUST_BRIDGE_CURSOR_MARKER = 'qce-ai-backup: request one latest message for a stable history cursor';
const RUST_BRIDGE_CURSOR_PATCH = `${RUST_BRIDGE_ARGS_LINE}
        // ${RUST_BRIDGE_CURSOR_MARKER}
        if (
          (method === 'MsgService.getAioFirstViewLatestMsgs' ||
            method === 'MsgApi.getAioFirstViewLatestMsgs') &&
          Number(args[1]) > 1
        ) {
          args[1] = 1;
        }`;

export function applyQceHistoryPaginationPatch(qceDir: string, logs: LogService): void {
  const fetcherPaths = findFetcherPaths(qceDir);
  const rustBridgePaths = findRustBridgePaths(qceDir);
  if (!fetcherPaths.length && !rustBridgePaths.length) {
    logs.warn('qce', '未找到 QCE BatchMessageFetcher，跳过历史分页兼容补丁');
    return;
  }

  for (const fetcherPath of fetcherPaths) patchFetcherFile(fetcherPath, logs);
  for (const rustBridgePath of rustBridgePaths) patchRustBridgeFile(rustBridgePath, logs);

  if ((readQceMajorVersion(qceDir) ?? 0) >= 6 && !rustBridgePaths.length) {
    logs.warn('qce', 'QCE 6+ 未找到 rustBridge.mjs，无法应用稳定历史游标补丁');
  }
}

function patchRustBridgeFile(rustBridgePath: string, logs: LogService): void {
  try {
    const source = readFileSync(rustBridgePath, 'utf8');
    if (source.includes(RUST_BRIDGE_CURSOR_MARKER)) return;
    if (!source.includes(RUST_BRIDGE_ARGS_LINE)) {
      logs.warn('qce', `QCE Rust bridge 与当前稳定游标补丁不匹配：${rustBridgePath}`);
      return;
    }

    const patched = source.replace(RUST_BRIDGE_ARGS_LINE, RUST_BRIDGE_CURSOR_PATCH);
    const backupPath = `${rustBridgePath}.qce-ai-backup.bak`;
    if (!existsSync(backupPath)) copyFileSync(rustBridgePath, backupPath);
    writeFileSync(rustBridgePath, patched, 'utf8');
    logs.info('qce', `已应用 QCE 6+ 稳定历史游标补丁：${rustBridgePath}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logs.warn('qce', `应用 QCE 6+ 稳定历史游标补丁失败：${message}`);
  }
}

function patchFetcherFile(fetcherPath: string, logs: LogService): void {
  try {
    const source = readFileSync(fetcherPath, 'utf8');
    let patched = source
      .replace(LEGACY_WRONG_EARLY_STOP_V1, LEGACY_OUTER_EARLY_STOP)
      .replace(LEGACY_WRONG_EARLY_STOP, LEGACY_OUTER_EARLY_STOP)
      .replace(EARLY_STOP_PATCHED_V1, EARLY_STOP_PATCHED);
    if (patched.includes(FIRST_PAGE_ORIGINAL)) {
      patched = patched.replace(FIRST_PAGE_ORIGINAL, FIRST_PAGE_PATCHED);
    }
    patched = patched.replace(FIRST_PAGE_LOG_ORIGINAL, FIRST_PAGE_LOG_PATCHED);
    if (!patched.includes(EARLY_STOP_MARKER) && patched.includes(EARLY_STOP_ORIGINAL)) {
      patched = replaceLast(patched, EARLY_STOP_ORIGINAL, EARLY_STOP_PATCHED);
    }
    patched = patchTypeScriptEarlyStop(patched);

    const firstPageReady = patched.includes(FIRST_PAGE_PATCHED);
    const earlyStopReady = patched.includes(EARLY_STOP_MARKER);
    if (!firstPageReady || !earlyStopReady) {
      logs.warn('qce', `QCE 历史分页兼容补丁与当前版本不匹配：${fetcherPath}`);
      return;
    }
    if (patched === source) return;

    const backupPath = `${fetcherPath}.qce-ai-backup.bak`;
    if (!existsSync(backupPath)) copyFileSync(fetcherPath, backupPath);
    writeFileSync(fetcherPath, patched, 'utf8');
    logs.info('qce', `已应用 QCE 历史分页兼容补丁：${fetcherPath}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logs.warn('qce', `应用 QCE 历史分页兼容补丁失败：${message}`);
  }
}

function patchTypeScriptEarlyStop(source: string): string {
  if (source.includes(EARLY_STOP_MARKER)) return source;

  const expressionIndex = source.lastIndexOf(EARLY_STOP_TS_EXPRESSION);
  if (expressionIndex < 0) return source;

  const expressionEnd = expressionIndex + EARLY_STOP_TS_EXPRESSION.length;
  const closingMatch = /^(\r?\n)([ \t]*)\) \{/.exec(source.slice(expressionEnd));
  if (!closingMatch) return source;

  const lineStart = source.lastIndexOf('\n', expressionIndex - 1) + 1;
  const conditionIndent = source.slice(lineStart, expressionIndex);
  if (!/^[ \t]*$/.test(conditionIndent)) return source;

  const newline = closingMatch[1];
  const outerIndent = closingMatch[2];
  const replacement = [
    'messages.every((msg) => {',
    `${conditionIndent}    const rawTime = parseInt(msg.msgTime);`,
    `${conditionIndent}    const msgTime = rawTime > 1000000000 && rawTime < 10000000000 ? rawTime * 1000 : rawTime;`,
    `${conditionIndent}    return Number.isFinite(msgTime) && msgTime < Number(filter.startTime);`,
    `${conditionIndent}})`,
    `${outerIndent}) { // ${EARLY_STOP_MARKER}`
  ].join(newline);

  return source.slice(0, expressionIndex) + replacement + source.slice(expressionEnd + closingMatch[0].length);
}

function replaceLast(source: string, search: string, replacement: string): string {
  const index = source.lastIndexOf(search);
  if (index < 0) return source;
  return source.slice(0, index) + replacement + source.slice(index + search.length);
}

function findFetcherPaths(qceDir: string): string[] {
  const paths: string[] = [];
  const pluginNames = ['napcat-plugin-qce', 'qq-chat-exporter'];
  for (const pluginName of pluginNames) {
    const pluginDir = join(qceDir, 'plugins', pluginName);
    const candidates = [
      join(pluginDir, 'lib', 'core', 'fetcher', 'BatchMessageFetcher.ts'),
      join(pluginDir, 'dist', 'core', 'fetcher', 'BatchMessageFetcher.js')
    ];
    for (const candidate of candidates) {
      if (existsSync(candidate)) paths.push(candidate);
    }
  }
  return paths;
}

function findRustBridgePaths(qceDir: string): string[] {
  const paths: string[] = [];
  const pluginNames = ['napcat-plugin-qce', 'qq-chat-exporter'];
  for (const pluginName of pluginNames) {
    const candidate = join(qceDir, 'plugins', pluginName, 'runtime', 'rustBridge.mjs');
    if (existsSync(candidate)) paths.push(candidate);
  }
  return paths;
}
