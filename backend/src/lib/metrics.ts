import { getDb } from '../db/index.js';

export type EventType =
  | 'install'
  | 'catalog_watchlist'
  | 'catalog_diary'
  | 'catalog_friends'
  | 'catalog_list'
  | 'catalog_popular'
  | 'catalog_top250'
  | 'stream'
  | 'action_watched'
  | 'action_liked'
  | 'action_watchlist'
  | 'action_rate'
  | 'login';

export function trackEvent(event: EventType, userId?: string, metadata?: Record<string, unknown>): void {
  try {
    const db = getDb();
    db.prepare(
      'INSERT INTO events (event, user_id, metadata) VALUES (?, ?, ?)'
    ).run(event, userId ?? null, metadata ? JSON.stringify(metadata) : null);
  } catch {
    // Silently fail — metrics should never break the app
  }
}

export interface MetricsSummary {
  total_events: number;
  total_users: number;
  events_by_type: Record<string, number>;
  daily_events: Array<{ date: string; count: number }>;
  daily_active_users: Array<{ date: string; count: number }>;
  top_catalogs: Array<{ catalog: string; count: number }>;
}

export function getMetricsSummary(days: number = 30): MetricsSummary {
  const db = getDb();
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const totalEvents = db.prepare(
    'SELECT COUNT(*) as count FROM events WHERE created_at >= ?'
  ).get(since) as { count: number };

  const totalUsers = db.prepare(
    'SELECT COUNT(DISTINCT user_id) as count FROM events WHERE user_id IS NOT NULL AND created_at >= ?'
  ).get(since) as { count: number };

  const eventsByType = db.prepare(
    'SELECT event, COUNT(*) as count FROM events WHERE created_at >= ? GROUP BY event ORDER BY count DESC'
  ).all(since) as Array<{ event: string; count: number }>;

  const dailyEvents = db.prepare(
    `SELECT date(created_at) as date, COUNT(*) as count
     FROM events WHERE created_at >= ?
     GROUP BY date(created_at) ORDER BY date DESC`
  ).all(since) as Array<{ date: string; count: number }>;

  const dailyActiveUsers = db.prepare(
    `SELECT date(created_at) as date, COUNT(DISTINCT user_id) as count
     FROM events WHERE user_id IS NOT NULL AND created_at >= ?
     GROUP BY date(created_at) ORDER BY date DESC`
  ).all(since) as Array<{ date: string; count: number }>;

  const topCatalogs = db.prepare(
    `SELECT event as catalog, COUNT(*) as count
     FROM events WHERE event LIKE 'catalog_%' AND created_at >= ?
     GROUP BY event ORDER BY count DESC`
  ).all(since) as Array<{ catalog: string; count: number }>;

  const byTypeMap: Record<string, number> = {};
  for (const row of eventsByType) {
    byTypeMap[row.event] = row.count;
  }

  return {
    total_events: totalEvents.count,
    total_users: totalUsers.count,
    events_by_type: byTypeMap,
    daily_events: dailyEvents,
    daily_active_users: dailyActiveUsers,
    top_catalogs: topCatalogs,
  };
}
