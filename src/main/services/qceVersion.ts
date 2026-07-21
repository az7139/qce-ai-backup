import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

const PLUGIN_NAMES = ['napcat-plugin-qce', 'qq-chat-exporter'];

export function readQceVersion(qceDir: string): string | undefined {
  if (!qceDir) return undefined;
  for (const pluginName of PLUGIN_NAMES) {
    const packagePath = join(qceDir, 'plugins', pluginName, 'package.json');
    try {
      if (!existsSync(packagePath)) continue;
      const parsed = JSON.parse(readFileSync(packagePath, 'utf8')) as { version?: string };
      if (parsed.version) return parsed.version.replace(/^v/i, '');
    } catch {
      // Fall back to the version embedded in the containing directory name.
    }
  }

  for (let current = resolve(qceDir); ; current = dirname(current)) {
    const match = /^NapCat-QCE-Windows-x64-v(.+)$/i.exec(basename(current));
    if (match) return match[1];
    const parent = dirname(current);
    if (parent === current) break;
  }
  return undefined;
}

export function readQceMajorVersion(qceDir: string): number | undefined {
  const major = Number(readQceVersion(qceDir)?.split('.')[0]);
  return Number.isInteger(major) ? major : undefined;
}
