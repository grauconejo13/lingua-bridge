import type { AdminStatus } from '@lingua-bridge/shared';
import { request } from './api';

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

export async function getAdminStatus(token: string): Promise<AdminStatus> {
  return (
    await request('/api/admin/status', { headers: auth(token) })
  ).json() as Promise<AdminStatus>;
}

export async function setPaused(token: string, paused: boolean): Promise<AdminStatus> {
  const response = await request('/api/admin/pause', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...auth(token) },
    body: JSON.stringify({ paused }),
  });
  return response.json() as Promise<AdminStatus>;
}
