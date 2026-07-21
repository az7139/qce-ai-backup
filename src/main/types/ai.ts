export type AiTestResult = {
  ok: boolean;
  message: string;
  raw?: unknown;
};

export type AiSummarizeInput = {
  systemPrompt: string;
  userPrompt: string;
  model?: string;
  temperature: number;
  maxOutputTokens?: number;
};

export type AiSummarizeResult = {
  content: string;
  raw: unknown;
  providerId?: string;
  providerName?: string;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
};
