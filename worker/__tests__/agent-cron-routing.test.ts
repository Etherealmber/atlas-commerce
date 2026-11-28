import { expect, it, vi } from 'vitest';
import { AGENT_CLEANUP_CRON, DAILY_BUSINESS_CRON, classifyScheduledJob } from '../lib/agentCronRouting';
import { runScheduledAgentCleanup } from '../lib/agentCleanupScheduled';
import { readFileSync } from 'node:fs';

it('routes frequent Agent cleanup separately from the daily business jobs', () => {
  expect(classifyScheduledJob(AGENT_CLEANUP_CRON)).toBe('agent-cleanup');
  expect(classifyScheduledJob(DAILY_BUSINESS_CRON)).toBe('daily-business');
  expect(classifyScheduledJob('0 * * * *')).toBe('unknown');
  expect(classifyScheduledJob(undefined)).toBe('unknown');
  const config = readFileSync('wrangler.jsonc', 'utf8');
  expect(config).toContain(`"${AGENT_CLEANUP_CRON}"`);
  expect(config).toContain(`"${DAILY_BUSINESS_CRON}"`);
});

it('the frequent pass performs no storage calls before the opt-in', async () => {
  const list = vi.fn();
  expect(await runScheduledAgentCleanup({ ENVIRONMENT: 'production', IMAGES: { list } } as any)).toEqual({ skipped: true });
  expect(list).not.toHaveBeenCalled();
});
