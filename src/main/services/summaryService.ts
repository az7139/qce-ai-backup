import { readFileSync } from 'node:fs';
import type { BackupPlan, SummaryConfig, AiConfig } from '../types/config';
import type { BackupWindow, ChatMessage } from '../types/backup';
import { AiClient } from './aiClient';
import { LogService } from './logService';

export class SummaryService {
  constructor(
    private readonly aiClient: AiClient,
    private readonly logs: LogService
  ) {}

  parseExport(filePath: string): ChatMessage[] {
    const rawText = readFileSync(filePath, 'utf8');
    if (!rawText.trim()) throw new Error('聊天记录为空');
    if (filePath.toLowerCase().endsWith('.txt')) return parseTxt(rawText);
    const raw = JSON.parse(rawText);
    const rows = findMessageArray(raw);
    const messages = rows.map(normalizeMessage).filter((message) => message.content.trim());
    if (!messages.length) throw new Error('聊天记录为空');
    return messages;
  }

  async summarize(
    messages: ChatMessage[],
    plan: BackupPlan,
    window: BackupWindow,
    summaryConfig: SummaryConfig,
    aiConfig: AiConfig,
    onProgress?: (event: { step: string; message: string }) => void
  ): Promise<string> {
    const chunks = chunkMessages(messages, summaryConfig.chunking.maxMessagesPerChunk, summaryConfig.chunking.maxCharsPerChunk);
    this.logs.info('ai', `开始分块总结：${chunks.length} 块`);
    onProgress?.({ step: 'chunking', message: `已拆分为 ${chunks.length} 个总结块` });

    const chunkSummaries: string[] = [];
    for (let index = 0; index < chunks.length; index += 1) {
      onProgress?.({ step: 'ai_chunk', message: `开始调用 AI，总结第 ${index + 1}/${chunks.length} 块` });
      const userPrompt = fillTemplate(summaryConfig.prompts.chunkPromptTemplate, {
        groupName: plan.target.groupName || plan.target.groupCode,
        groupCode: plan.target.groupCode,
        startAt: window.startAt,
        endAt: window.endAt,
        chunkIndex: String(index + 1),
        chunkTotal: String(chunks.length),
        chatText: chunks[index]
      });
      const result = await this.aiClient.summarize(aiConfig, {
        systemPrompt: summaryConfig.prompts.systemPrompt,
        userPrompt,
        temperature: aiConfig.temperature
      });
      chunkSummaries.push(result.content.slice(0, summaryConfig.chunking.maxIntermediateSummaryChars));
      this.logs.info('ai', `分块总结 ${index + 1}/${chunks.length} 完成`);
      onProgress?.({ step: 'ai_chunk_done', message: `第 ${index + 1}/${chunks.length} 块总结完成，返回 ${result.content.length} 字` });
    }

    if (!summaryConfig.chunking.enableMapReduce || chunkSummaries.length === 1) {
      onProgress?.({ step: 'summary_done', message: `总结完成，输出 ${chunkSummaries[0]?.length ?? 0} 字` });
      return chunkSummaries[0];
    }
    onProgress?.({ step: 'ai_final', message: '开始调用 AI 合并分块总结' });
    const finalPrompt = fillTemplate(summaryConfig.prompts.finalPromptTemplate, {
      groupName: plan.target.groupName || plan.target.groupCode,
      groupCode: plan.target.groupCode,
      startAt: window.startAt,
      endAt: window.endAt,
      chunkSummaries: chunkSummaries.join('\n\n---\n\n')
    });
    try {
      const final = await this.aiClient.summarize(aiConfig, {
        systemPrompt: summaryConfig.prompts.systemPrompt,
        userPrompt: finalPrompt,
        temperature: aiConfig.temperature
      });
      onProgress?.({ step: 'summary_done', message: `最终总结完成，输出 ${final.content.length} 字` });
      return final.content;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logs.warn('ai', `最终合并总结失败，降级保存分块总结：${message}`);
      onProgress?.({ step: 'ai_final_fallback', message: `最终合并失败：${message}。已降级保存 ${chunkSummaries.length} 个分块总结。` });
      const fallback = buildFallbackSummary(chunkSummaries, message);
      onProgress?.({ step: 'summary_done', message: `分块总结整理完成，输出 ${fallback.length} 字` });
      return fallback;
    }
  }

  toChatText(messages: ChatMessage[]): string {
    return messages.map(formatMessage).join('\n');
  }
}

function buildFallbackSummary(chunkSummaries: string[], reason: string): string {
  const sections = chunkSummaries.map((summary, index) => {
    return [`### 分块 ${index + 1}`, '', summary.trim()].join('\n');
  });
  return [
    '> 最终合并步骤未完成，以下内容为已成功生成的分块总结汇总。',
    `> 失败原因：${reason}`,
    '',
    ...sections
  ].join('\n\n');
}

function findMessageArray(raw: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(raw)) return raw as Array<Record<string, unknown>>;
  const root = raw as Record<string, unknown>;
  for (const key of ['messages', 'records', 'list', 'data']) {
    const value = root?.[key];
    if (Array.isArray(value)) return value as Array<Record<string, unknown>>;
    if (value && typeof value === 'object') {
      const nested = findMessageArray(value);
      if (nested.length) return nested;
    }
  }
  return [];
}

function normalizeMessage(row: Record<string, unknown>): ChatMessage {
  const time = stringOrUndefined(row.time ?? row.msgTime ?? row.sendTime ?? row.timestamp);
  const sender = stringOrUndefined(row.senderName ?? row.nickname ?? row.sender ?? row.userName ?? row.memberName);
  const senderId = stringOrUndefined(row.senderId ?? row.userId ?? row.uin);
  const type = stringOrUndefined(row.type ?? row.msgType ?? row.messageType);
  const content = stringOrUndefined(row.content ?? row.text ?? row.message ?? row.msg) ?? JSON.stringify(row);
  return { time, sender, senderId, type, content, raw: row };
}

function parseTxt(raw: string): ChatMessage[] {
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((content) => ({ content }));
}

function chunkMessages(messages: ChatMessage[], maxMessages: number, maxChars: number): string[] {
  const chunks: string[] = [];
  let current: string[] = [];
  let charCount = 0;
  for (const message of messages) {
    const line = formatMessage(message);
    if (current.length && (current.length >= maxMessages || charCount + line.length > maxChars)) {
      chunks.push(current.join('\n'));
      current = [];
      charCount = 0;
    }
    current.push(line);
    charCount += line.length;
  }
  if (current.length) chunks.push(current.join('\n'));
  return chunks;
}

function formatMessage(message: ChatMessage): string {
  const parts = [message.time, message.sender || message.senderId].filter(Boolean);
  return parts.length ? `[${parts.join(' ')}] ${message.content}` : message.content;
}

function fillTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{(\w+)}}/g, (_, key: string) => values[key] ?? '');
}

function stringOrUndefined(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  return String(value);
}
