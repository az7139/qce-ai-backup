export type WeeklySummaryPathInput = {
  groupName?: string;
  groupCode?: string;
  startAt?: string;
  startedAt?: string;
  exportFilePath?: string;
};

export function buildWeeklySummaryMarkdownPath(configSummaryPath: string, record?: WeeklySummaryPathInput): string {
  if (!record) return configSummaryPath || '';
  const baseDir = getConfiguredDirectory(configSummaryPath) || getDirectoryName(record.exportFilePath || '') || '';
  const groupShortName = makeGroupShortName(record.groupName || record.groupCode || '群聊');
  const week = getWeekDateRange(record.startAt || record.startedAt || new Date().toISOString());
  const fileName = `${groupShortName}_${week.start}-${week.end}_总结.md`;
  return baseDir ? `${baseDir}${getPathSeparator(baseDir)}${fileName}` : fileName;
}

function getConfiguredDirectory(pathValue: string): string {
  const value = (pathValue || '').trim();
  if (!value) return '';
  return /\.md$/i.test(value) ? getDirectoryName(value) : value.replace(/[\\/]+$/, '');
}

function getDirectoryName(pathValue: string): string {
  const value = (pathValue || '').trim();
  if (!value) return '';
  const normalized = value.replace(/[\\/]+$/, '');
  const slash = Math.max(normalized.lastIndexOf('\\'), normalized.lastIndexOf('/'));
  if (slash <= 0) return '';
  return normalized.slice(0, slash);
}

function getPathSeparator(pathValue: string): string {
  return pathValue.includes('\\') ? '\\' : '/';
}

function makeGroupShortName(value: string): string {
  const cleaned = value
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, '')
    .replace(/[_-]{2,}/g, '_')
    .replace(/^_+|_+$/g, '');
  return (cleaned || '群聊').slice(0, 18);
}

function getWeekDateRange(value: string): { start: string; end: string } {
  const date = parseDateTime(value);
  const day = date.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const monday = new Date(date);
  monday.setDate(date.getDate() + mondayOffset);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return { start: formatDateCompact(monday), end: formatDateCompact(sunday) };
}

function parseDateTime(value: string): Date {
  const normalized = value.includes(' ') ? value.replace(' ', 'T') : value;
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function formatDateCompact(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}
