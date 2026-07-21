import axios from 'axios';
import type { AiConfig, AiProviderConfig } from '../types/config';
import type { AiSummarizeInput, AiSummarizeResult, AiTestResult } from '../types/ai';
import { LogService } from './logService';

export class AiClient {
  constructor(private readonly logs: LogService) {}

  async testConnection(config: AiConfig, providerId?: string): Promise<AiTestResult> {
    try {
      const provider = providerId
        ? this.resolveProviders(config, true).find((item) => item.id === providerId)
        : this.resolveProviders(config)[0];
      if (!provider) return { ok: false, message: '没有可用的 AI 配置' };
      const result = await this.summarizeWithProvider(config, provider, {
        systemPrompt: '你是一个连接测试助手。',
        userPrompt: '请只回复 ok。',
        temperature: config.temperature,
        maxOutputTokens: 20
      });
      return { ok: Boolean(result.content), message: `${provider.name} 连接可用`, raw: result.raw };
    } catch (error) {
      return { ok: false, message: errorToMessage(error) };
    }
  }

  async summarize(config: AiConfig, input: AiSummarizeInput): Promise<AiSummarizeResult> {
    const providers = this.resolveProviders(config);
    if (!providers.length) throw new Error('没有可用的 AI 配置');

    const errors: string[] = [];
    for (const provider of providers) {
      try {
        return await this.summarizeWithProvider(config, provider, input);
      } catch (error) {
        const message = errorToMessage(error);
        errors.push(`${provider.name}: ${message}`);
        this.logs.warn('ai', `${provider.name} 调用失败，准备尝试下一个 AI：${message}`);
      }
    }
    throw new Error(`所有 AI 配置均调用失败：${errors.join('；')}`);
  }

  private resolveProviders(config: AiConfig, includeDisabled = false): AiProviderConfig[] {
    const providers = config.providers?.length
      ? config.providers
      : [
          {
            id: 'primary',
            name: '主 AI',
            enabled: true,
            role: 'primary' as const,
            providerType: config.providerType,
            openaiCompatible: config.openaiCompatible
          }
        ];
    return providers
      .filter((provider) => includeDisabled || provider.enabled)
      .sort((left, right) => Number(left.role !== 'primary') - Number(right.role !== 'primary'));
  }

  private async summarizeWithProvider(config: AiConfig, providerConfig: AiProviderConfig, input: AiSummarizeInput): Promise<AiSummarizeResult> {
    if (providerConfig.providerType !== 'openaiCompatible') {
      throw new Error('当前仅支持 OpenAI-compatible API');
    }
    const provider = providerConfig.openaiCompatible;
    if (!provider?.apiKey) throw new Error('AI API Key 为空');
    const model = input.model || provider.model;
    if (!model) throw new Error('AI 模型名为空');

    const url = `${provider.baseUrl.replace(/\/$/, '')}${provider.chatCompletionsPath}`;
    const response = await this.withRetries(providerConfig.name, config.maxRetries, config.retryDelaySeconds, async () =>
      axios.post(
        url,
        {
          model,
          messages: [
            { role: 'system', content: input.systemPrompt },
            { role: 'user', content: input.userPrompt }
          ],
          temperature: input.temperature,
          max_tokens: input.maxOutputTokens ?? provider.maxOutputTokens
        },
        {
          timeout: config.timeoutSeconds * 1000,
          headers: {
            Authorization: `Bearer ${provider.apiKey}`,
            'Content-Type': 'application/json',
            ...(provider.headers ?? {})
          }
        }
      )
    );
    const content = response.data?.choices?.[0]?.message?.content;
    if (!content) throw new Error('AI 返回空内容');
    this.logs.info('ai', `AI 总结完成，配置：${providerConfig.name}，模型：${model}`);
    return {
      content,
      raw: response.data,
      providerId: providerConfig.id,
      providerName: providerConfig.name,
      usage: {
        promptTokens: response.data?.usage?.prompt_tokens,
        completionTokens: response.data?.usage?.completion_tokens,
        totalTokens: response.data?.usage?.total_tokens
      }
    };
  }

  private async withRetries<T>(providerName: string, maxRetries: number, delaySeconds: number, fn: () => Promise<T>): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;
        this.logs.warn('ai', `${providerName} 请求失败，attempt=${attempt + 1}/${maxRetries + 1}：${errorToMessage(error)}`);
        if (attempt < maxRetries) await sleep(delaySeconds * 1000);
      }
    }
    throw lastError;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorToMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
