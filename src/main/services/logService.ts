import { app } from 'electron';
import { EventEmitter } from 'node:events';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import dayjs from 'dayjs';

export type LogChannel = 'app' | 'qce' | 'backup' | 'ai' | 'markdown';
export type LogLevel = 'INFO' | 'WARN' | 'ERROR';

export class LogService extends EventEmitter {
  readonly logDir: string;

  constructor() {
    super();
    this.logDir = join(app.getPath('appData'), 'QCE AI Backup', 'logs');
    mkdirSync(this.logDir, { recursive: true });
  }

  line(level: LogLevel, channel: LogChannel, message: string): string {
    const redacted = redactSecrets(message);
    const line = `[${dayjs().format('YYYY-MM-DD HH:mm:ss')}] [${level}] [${channel}] ${redacted}`;
    appendFileSync(join(this.logDir, `${channel === 'qce' ? 'qce-console' : channel}.log`), `${line}\n`, 'utf8');
    if (channel !== 'app') {
      appendFileSync(join(this.logDir, 'app.log'), `${line}\n`, 'utf8');
    }
    this.emit('line', line);
    return line;
  }

  info(channel: LogChannel, message: string): void {
    this.line('INFO', channel, message);
  }

  warn(channel: LogChannel, message: string): void {
    this.line('WARN', channel, message);
  }

  error(channel: LogChannel, message: string): void {
    this.line('ERROR', channel, message);
  }

  recent(limit = 500): string[] {
    const path = join(this.logDir, 'app.log');
    if (!existsSync(path)) return [];
    return readFileSync(path, 'utf8').split(/\r?\n/).filter(Boolean).slice(-limit);
  }

  clear(): void {
    for (const name of ['app.log', 'qce-console.log', 'backup.log', 'ai.log', 'markdown.log']) {
      writeFileSync(join(this.logDir, name), '', 'utf8');
    }
    this.emit('line', '[logs cleared]');
  }
}

export function redactSecrets(input: string): string {
  return input
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, (value) => `${value.slice(0, 3)}****${value.slice(-4)}`)
    .replace(/(accessToken["']?\s*[:=]\s*["']?)([^"',\s]+)/gi, '$1****')
    .replace(/(apiKey["']?\s*[:=]\s*["']?)([^"',\s]+)/gi, '$1****')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer ****');
}
