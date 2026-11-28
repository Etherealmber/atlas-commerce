/** Keep frequent Agent cleanup separate from the existing daily business jobs. */
export const AGENT_CLEANUP_CRON = '*/15 * * * *';
export const DAILY_BUSINESS_CRON = '35 7 * * *';

export function classifyScheduledJob(cron: unknown): 'agent-cleanup' | 'daily-business' | 'unknown' {
  if (cron === AGENT_CLEANUP_CRON) return 'agent-cleanup';
  if (cron === DAILY_BUSINESS_CRON) return 'daily-business';
  return 'unknown';
}
