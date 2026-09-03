import { describe, expect, it } from 'vitest';

import { createLogger, REDACTED } from './logger.js';
import { collectLogs } from './test-support/logs.js';

const SECRET = 'which postgres hosting should I use for a side project';

describe('createLogger', () => {
  it('never emits message content, wherever it sits', () => {
    const { lines, stream } = collectLogs();
    const logger = createLogger({ level: 'info' }, stream);

    logger.info({ messages: [{ role: 'user', content: SECRET }] }, 'top level');
    logger.info({ body: { messages: [{ role: 'user', content: SECRET }] } }, 'nested');
    logger.info({ request: { body: { messages: [{ role: 'user', content: SECRET }] } } }, 'deep');
    logger.info({ context_summary: SECRET }, 'summary');
    logger.info({ body: { context_summary: SECRET } }, 'nested summary');

    expect(lines).toHaveLength(5);
    for (const line of lines) {
      expect(line).not.toContain(SECRET);
      expect(line).toContain(REDACTED);
    }
  });

  it('never emits authorization headers or bearer tokens', () => {
    const { lines, stream } = collectLogs();
    const logger = createLogger({ level: 'info' }, stream);
    const token = 'Bearer ak_live_SECRETSECRET';

    logger.info({ authorization: token }, 'bare');
    logger.info({ headers: { authorization: token } }, 'headers');
    logger.info({ req: { headers: { authorization: token } } }, 'req');
    logger.info({ headers: { Authorization: token } }, 'capitalised');

    expect(lines).toHaveLength(4);
    for (const line of lines) {
      expect(line).not.toContain('SECRETSECRET');
    }
  });

  it('keeps the other fields and the message', () => {
    const { lines, stream } = collectLogs();
    const logger = createLogger({ level: 'info' }, stream);
    logger.info({ req_id: '01ARZ3NDEKTSV4RRFFQ69G5FAV', messages: ['x'] }, 'evaluated');
    const entry = JSON.parse(lines[0] ?? '{}') as Record<string, unknown>;
    expect(entry['req_id']).toBe('01ARZ3NDEKTSV4RRFFQ69G5FAV');
    expect(entry['msg']).toBe('evaluated');
    expect(entry['messages']).toBe(REDACTED);
    expect(entry['service']).toBe('adgate-gateway');
    expect(typeof entry['time']).toBe('string');
  });

  it('honours the level', () => {
    const { lines, stream } = collectLogs();
    const logger = createLogger({ level: 'warn' }, stream);
    logger.info('hidden');
    logger.debug('hidden');
    logger.warn('shown');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('shown');
  });

  it('can be silenced', () => {
    const { lines, stream } = collectLogs();
    const logger = createLogger({ level: 'silent' }, stream);
    logger.error('nothing');
    expect(lines).toHaveLength(0);
  });
});
