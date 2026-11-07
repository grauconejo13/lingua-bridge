import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AdminStatus, ProviderId } from '@lingua-bridge/shared';
import { AppError } from '../errors';
import type { UsageMeter } from './meter';

function tokenMatches(request: FastifyRequest, token: string): boolean {
  const header = request.headers.authorization;
  const given = Buffer.from(header?.startsWith('Bearer ') ? header.slice(7) : '');
  const expected = Buffer.from(token);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

const PauseSchema = z.object({ paused: z.boolean() });

/**
 * Operator endpoints: usage, live counts and the pause switch. Registered only when
 * ADMIN_TOKEN is set; without it the routes don't exist. Responses contain aggregates only.
 */
export function registerAdmin(
  app: FastifyInstance,
  options: {
    token: string | undefined;
    meter: UsageMeter;
    provider: { id: ProviderId; demoMode: boolean };
    live: () => AdminStatus['live'];
  },
): void {
  const { token, meter } = options;
  if (!token) return;

  const auth = {
    onRequest: async (request: FastifyRequest) => {
      if (!tokenMatches(request, token)) {
        throw new AppError('BAD_REQUEST', 'Admin token missing or wrong.', 401);
      }
    },
  };

  const status = (): AdminStatus => ({
    usage: meter.snapshot(),
    live: options.live(),
    uptimeSeconds: Math.round((Date.now() - meter.startedAt) / 1000),
    provider: options.provider.id,
    demoMode: options.provider.demoMode,
  });

  app.get('/api/admin/status', auth, async (_request, reply) => {
    reply.header('Cache-Control', 'no-store');
    return status();
  });

  app.post('/api/admin/pause', auth, async (request) => {
    const body = PauseSchema.safeParse(request.body);
    if (!body.success)
      throw new AppError('BAD_REQUEST', 'Expected { "paused": true | false }.', 400);
    meter.setPaused(body.data.paused);
    request.log.warn({ paused: body.data.paused }, 'translation pause switched');
    return status();
  });
}
