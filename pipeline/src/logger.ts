import pino from 'pino';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const LOG_DIR = resolve(process.env.HOME!, '.amerikagundemi', 'logs');
mkdirSync(LOG_DIR, { recursive: true });

const today = new Date().toISOString().split('T')[0];

export const logger = pino({
  transport: {
    targets: [
      {
        target: 'pino/file',
        options: { destination: resolve(LOG_DIR, `pipeline-${today}.log`) },
        level: 'info',
      },
      {
        target: 'pino-pretty',
        options: { colorize: true },
        level: 'info',
      },
    ],
  },
});

export async function alertFailure(message: string): Promise<void> {
  logger.error({ alert: true }, message);
  try {
    const { execFile } = await import('node:child_process');
    execFile('osascript', [
      '-e',
      `display notification "${message.replace(/"/g, '\\"')}" with title "AmerikaGundemi Pipeline"`,
    ]);
  } catch {
    // alerting is best-effort
  }
}
