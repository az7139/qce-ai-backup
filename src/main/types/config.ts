export type QceConfig = {
  qceDir: string;
  launcherBat: string;
  quickLoginUin: string;
  baseUrl: string;
  securityJsonPath: string;
  startupTimeoutSeconds: number;
  onlineTimeoutSeconds: number;
  historySyncDelaySeconds: number;
  updateProxyUrl: string;
  autoCheckUpdatesOnLaunch: boolean;
  autoStartOnAppLaunch: boolean;
  autoStartQceBeforeBackup: boolean;
  shutdownQceAfterSuccess: boolean;
  shutdownQceAfterFailure: boolean;
  forceKillQceOnShutdown: boolean;
  showWindowWhenLoginRequired: boolean;
  showQceConsole: boolean;
};

export type BackupConfig = {
  plans: BackupPlan[];
  preventDuplicateWindow: boolean;
  maxConcurrentBackups: number;
  exitAppAfterStartupSuccess: boolean;
};

export type BackupTarget = {
  type: 'group';
  groupCode: string;
  groupName?: string;
};

export type BackupSchedule =
  | { type: 'startup'; autoRunOnAppLaunch: boolean; delaySeconds: number; backfillDays: number };

export type BackupTimeWindow = {
  mode: 'relativeToRunDate' | 'absolute';
  relative?: {
    startDayOffset: number;
    startTime: string;
    endDayOffset: number;
    endTime: string;
  };
  absolute?: {
    startAt: string;
    endAt: string;
  };
  minDelayAfterWindowEndMinutes: number;
};

export type ExportFormat = 'HTML' | 'JSON' | 'TXT' | 'EXCEL';

export type ExportConfig = {
  primaryFormatForSummary: 'JSON' | 'TXT';
  archiveFormats: ExportFormat[];
  exportAsZip: boolean;
  includeResourceLinks: boolean;
  includeSystemMessages: boolean;
  filterPureImageMessages: boolean;
  prettyFormat: boolean;
  includeRecalled: boolean;
  preferGroupMemberName: boolean;
  batchSize: number;
  outputDir?: string;
  useFriendlyFileName: boolean;
  useNameInFileName: boolean;
  keywords?: string[];
  includeUserUins?: string[];
  excludeUserUins?: string[];
  skipDownloadResourceTypes?: string[];
};

export type AiSummaryPlanConfig = {
  enabled: boolean;
};

export type PostActionConfig = {
  shutdownQceAfterBackup: boolean;
  exitAppAfterBackupWhenStartupMode: boolean;
  keepQceOpenOnFailure: boolean;
};

export type RetryConfig = {
  maxAttempts: number;
  retryDelayMinutes: number;
};

export type BackupPlan = {
  id: string;
  enabled: boolean;
  name: string;
  target: BackupTarget;
  targets?: BackupTarget[];
  schedule: BackupSchedule;
  timeWindow: BackupTimeWindow;
  export: ExportConfig;
  aiSummary: AiSummaryPlanConfig;
  postAction: PostActionConfig;
  retry: RetryConfig;
  createdAt: string;
  updatedAt: string;
};

export type AiProviderType = 'openaiCompatible' | 'ollama' | 'customHttp';

export type OpenAiCompatibleConfig = {
  baseUrl: string;
  apiKey: string;
  model: string;
  chatCompletionsPath: string;
  headers?: Record<string, string>;
  maxOutputTokens?: number;
};

export type OllamaConfig = {
  baseUrl: string;
  model: string;
};

export type CustomHttpConfig = {
  url: string;
  method: 'POST';
  headers: Record<string, string>;
  bodyTemplate: string;
  responsePath: string;
};

export type AiProviderConfig = {
  id: string;
  name: string;
  enabled: boolean;
  role: 'primary' | 'fallback';
  providerType: AiProviderType;
  openaiCompatible?: OpenAiCompatibleConfig;
  ollama?: OllamaConfig;
  customHttp?: CustomHttpConfig;
};

export type AiConfig = {
  providerType: AiProviderType;
  openaiCompatible?: OpenAiCompatibleConfig;
  ollama?: OllamaConfig;
  customHttp?: CustomHttpConfig;
  providers: AiProviderConfig[];
  timeoutSeconds: number;
  maxRetries: number;
  retryDelaySeconds: number;
  temperature: number;
};

export type SummaryChunkingConfig = {
  maxMessagesPerChunk: number;
  maxCharsPerChunk: number;
  overlapMessages: number;
  enableMapReduce: boolean;
  maxIntermediateSummaryChars: number;
};

export type SummaryPromptConfig = {
  systemPrompt: string;
  chunkPromptTemplate: string;
  finalPromptTemplate: string;
};

export type SummaryOutputConfig = {
  titleTemplate: string;
  includeMetadata: boolean;
  includeMessageCount: boolean;
};

export type SummaryPrivacyConfig = {
  redactUserIds: boolean;
};

export type SummaryConfig = {
  enabled: boolean;
  chunking: SummaryChunkingConfig;
  prompts: SummaryPromptConfig;
  output: SummaryOutputConfig;
  privacy: SummaryPrivacyConfig;
};

export type MarkdownConfig = {
  markdownPath: string;
  summaryDir: string;
  writeMode: 'singleFile' | 'dailyFile' | 'groupFile';
  fileNameTemplate: string;
  duplicatePolicy: 'skipIfWindowExists' | 'replaceSameWindow' | 'appendAnyway';
  includeMetadataBlock: boolean;
};

export type UiConfig = {
  startMinimized: boolean;
  showConsoleByDefault: boolean;
};

export type AdvancedConfig = {
  pollIntervalSeconds: number;
  taskTimeoutSeconds: number;
  logRetentionDays: number;
};

export type AppConfig = {
  qce: QceConfig;
  backup: BackupConfig;
  ai: AiConfig;
  summary: SummaryConfig;
  markdown: MarkdownConfig;
  ui: UiConfig;
  advanced: AdvancedConfig;
};

export const defaultQceConfig: QceConfig = {
  qceDir: '',
  launcherBat: '',
  quickLoginUin: '',
  baseUrl: 'http://127.0.0.1:40653',
  securityJsonPath: '%USERPROFILE%\\.qq-chat-exporter\\security.json',
  startupTimeoutSeconds: 600,
  onlineTimeoutSeconds: 600,
  historySyncDelaySeconds: 10,
  updateProxyUrl: '',
  autoCheckUpdatesOnLaunch: true,
  autoStartOnAppLaunch: false,
  autoStartQceBeforeBackup: true,
  shutdownQceAfterSuccess: true,
  shutdownQceAfterFailure: false,
  forceKillQceOnShutdown: true,
  showWindowWhenLoginRequired: true,
  showQceConsole: true
};

export const defaultTimeWindow: BackupTimeWindow = {
  mode: 'relativeToRunDate',
  relative: {
    startDayOffset: -1,
    startTime: '03:00',
    endDayOffset: 0,
    endTime: '05:00'
  },
  minDelayAfterWindowEndMinutes: 10
};

export const defaultExportConfig: ExportConfig = {
  primaryFormatForSummary: 'TXT',
  archiveFormats: ['TXT'],
  exportAsZip: true,
  includeResourceLinks: true,
  includeSystemMessages: false,
  filterPureImageMessages: false,
  prettyFormat: true,
  includeRecalled: false,
  preferGroupMemberName: true,
  batchSize: 200,
  useFriendlyFileName: true,
  useNameInFileName: true
};

export const defaultOpenAiCompatibleConfig: OpenAiCompatibleConfig = {
  baseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  model: '',
  chatCompletionsPath: '/chat/completions',
  maxOutputTokens: 4000
};

export const defaultPrimaryAiProvider: AiProviderConfig = {
  id: 'primary',
  name: '主 AI',
  enabled: true,
  role: 'primary',
  providerType: 'openaiCompatible',
  openaiCompatible: defaultOpenAiCompatibleConfig
};

export const defaultAiConfig: AiConfig = {
  providerType: 'openaiCompatible',
  openaiCompatible: defaultOpenAiCompatibleConfig,
  ollama: {
    baseUrl: 'http://127.0.0.1:11434',
    model: ''
  },
  customHttp: {
    url: '',
    method: 'POST',
    headers: {},
    bodyTemplate: '',
    responsePath: 'choices.0.message.content'
  },
  providers: [defaultPrimaryAiProvider],
  timeoutSeconds: 300,
  maxRetries: 2,
  retryDelaySeconds: 5,
  temperature: 0.2
};

export const defaultSummaryConfig: SummaryConfig = {
  enabled: true,
  chunking: {
    maxMessagesPerChunk: 300,
    maxCharsPerChunk: 20000,
    overlapMessages: 20,
    enableMapReduce: true,
    maxIntermediateSummaryChars: 6000
  },
  prompts: {
    systemPrompt:
      '你是一个严谨的群聊记录整理助手。你的任务是总结 QQ 群聊天记录，不编造，不夸大，不泄露无关隐私。请按事实整理重点，保留时间、人物、任务、结论、争议和待办。',
    chunkPromptTemplate:
      '请总结以下 QQ 群聊天记录片段。\n\n要求：\n1. 按主题归类。\n2. 保留重要时间、人物、决定、链接、文件名、任务和结论。\n3. 如果有待办事项，请明确负责人、事项、截止时间；没有则写“无明确待办”。\n4. 如果有争议或未解决问题，请单独列出。\n5. 不要编造聊天记录中没有的信息。\n6. 输出 Markdown。\n\n群名：{{groupName}}\n群号：{{groupCode}}\n时间窗口：{{startAt}} 到 {{endAt}}\n片段序号：{{chunkIndex}} / {{chunkTotal}}\n\n聊天记录：\n{{chatText}}',
    finalPromptTemplate:
      '以下是多个聊天片段的阶段性总结。请合并成一份最终日报。\n\n要求：\n1. 去重。\n2. 按主题整合。\n3. 保留重要人物、时间、结论、链接、文件、待办。\n4. 输出结构固定为：\n   - 今日概览\n   - 重要讨论\n   - 关键决定\n   - 待办事项\n   - 风险与未解决问题\n   - 值得关注的信息\n\n群名：{{groupName}}\n群号：{{groupCode}}\n时间窗口：{{startAt}} 到 {{endAt}}\n\n片段总结：\n{{chunkSummaries}}'
  },
  output: {
    titleTemplate: '{{groupName}} {{startAt}} - {{endAt}} 群聊总结',
    includeMetadata: true,
    includeMessageCount: true
  },
  privacy: {
    redactUserIds: false
  }
};

export const defaultMarkdownConfig: MarkdownConfig = {
  markdownPath: '',
  summaryDir: '',
  writeMode: 'singleFile',
  fileNameTemplate: '{{date}}-{{groupName}}.md',
  duplicatePolicy: 'skipIfWindowExists',
  includeMetadataBlock: true
};

export const defaultAppConfig: AppConfig = {
  qce: defaultQceConfig,
  backup: {
    plans: [],
    preventDuplicateWindow: true,
    maxConcurrentBackups: 1,
    exitAppAfterStartupSuccess: true
  },
  ai: defaultAiConfig,
  summary: defaultSummaryConfig,
  markdown: defaultMarkdownConfig,
  ui: {
    startMinimized: false,
    showConsoleByDefault: true
  },
  advanced: {
    pollIntervalSeconds: 3,
    taskTimeoutSeconds: 1800,
    logRetentionDays: 14
  }
};
