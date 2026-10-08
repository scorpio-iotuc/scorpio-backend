import { formatWithOptions } from 'node:util';

/** One timestamped line per event; Docker captures stdout/stderr directly. */
export class Logger {
  constructor(private readonly service: string) { }

  info(message: string, ...details: unknown[]): void {
    this.write('INFO', message, details);
  }

  warn(message: string, ...details: unknown[]): void {
    this.write('WARN', message, details);
  }

  error(message: string, ...details: unknown[]): void {
    this.write('ERROR', message, details);
  }

  debug(message: string, ...details: unknown[]): void {
    this.write('DEBUG', message, details);
  }

  private write(level: string, message: string, details: unknown[]): void {
    const context = details.length
      ? ` ${formatWithOptions({ colors: false, compact: true, breakLength: Infinity }, ...details)}`
      : '';
    const line = `[${new Date().toISOString()}] [${level}] [${this.service}] ${message}${context}`
      .replace(/\r/g, '\\r').replace(/\n/g, '\\n');
    if (level === 'ERROR') console.error(line);
    else if (level === 'WARN') console.warn(line);
    else console.log(line);
  }
}
