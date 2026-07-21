import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { AppendSummaryInput, AppendSummaryResult } from '../types/summary';
import { LogService } from './logService';

export class MarkdownAppendService {
  constructor(private readonly logs: LogService) {}

  appendSummary(input: AppendSummaryInput): AppendSummaryResult {
    if (!input.markdownPath) {
      throw new Error('Markdown 路径未配置');
    }
    mkdirSync(dirname(input.markdownPath), { recursive: true });
    const marker = `qce-ai-backup:${input.windowKey}`;
    const startMarker = `<!-- ${marker}:start -->`;
    const endMarker = `<!-- ${marker}:end -->`;
    const section = [
      startMarker,
      `## ${input.title}`,
      '',
      this.formatMetadata(input.metadata),
      input.summaryMarkdown.trim(),
      '',
      endMarker,
      ''
    ]
      .filter((part) => part !== '')
      .join('\n');

    const current = existsSync(input.markdownPath) ? readFileSync(input.markdownPath, 'utf8') : '';
    const existing = findSection(current, startMarker, endMarker);
    if (existing && input.duplicatePolicy === 'skipIfWindowExists') {
      this.logs.info('markdown', `Markdown 已存在相同窗口，跳过：${input.windowKey}`);
      return { written: false, skipped: true, path: input.markdownPath, marker };
    }
    const next =
      existing && input.duplicatePolicy === 'replaceSameWindow'
        ? `${current.slice(0, existing.start)}${section}${current.slice(existing.end)}`
        : `${current.trimEnd()}\n\n${section}`;
    writeFileSync(input.markdownPath, next.trimStart(), 'utf8');
    this.logs.info('markdown', `已追加写入 Markdown：${input.markdownPath}`);
    return { written: true, skipped: false, path: input.markdownPath, marker };
  }

  private formatMetadata(metadata: Record<string, string | number | boolean>): string {
    const lines = Object.entries(metadata).map(([key, value]) => `- ${key}: ${value}`);
    return lines.length ? `${lines.join('\n')}\n` : '';
  }
}

function findSection(content: string, startMarker: string, endMarker: string): { start: number; end: number } | undefined {
  const start = content.indexOf(startMarker);
  if (start < 0) return undefined;
  const end = content.indexOf(endMarker, start);
  if (end < 0) return undefined;
  return { start, end: end + endMarker.length };
}
