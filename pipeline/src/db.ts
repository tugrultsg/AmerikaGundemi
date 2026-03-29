import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { VideoRecord, VideoStatus } from './types.js';

let db: Database.Database;

export function initDb(dbPath: string): Database.Database {
  mkdirSync(dirname(dbPath), { recursive: true });
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS videos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      video_id TEXT UNIQUE NOT NULL,
      channel TEXT NOT NULL,
      title TEXT,
      translated_title TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      strategy TEXT,
      raw_transcript TEXT,
      cleaned_transcript TEXT,
      summary_article TEXT,
      full_translation TEXT,
      tags TEXT,
      guests TEXT,
      thread TEXT,
      retry_count INTEGER DEFAULT 0,
      error_details TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      published_at TEXT
    );

    CREATE TABLE IF NOT EXISTS twitter_posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      video_id TEXT NOT NULL REFERENCES videos(video_id),
      tweet_ids TEXT NOT NULL,
      posted_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS quota_usage (
      date TEXT PRIMARY KEY,
      units_used INTEGER DEFAULT 0
    );
  `);

  return db;
}

export function getDb(): Database.Database {
  if (!db) throw new Error('Database not initialized. Call initDb() first.');
  return db;
}

export function insertVideo(videoId: string, channel: string, title: string): void {
  const stmt = getDb().prepare(`
    INSERT OR IGNORE INTO videos (video_id, channel, title)
    VALUES (?, ?, ?)
  `);
  stmt.run(videoId, channel, title);
}

export function getVideoByVideoId(videoId: string): VideoRecord | undefined {
  return getDb().prepare('SELECT * FROM videos WHERE video_id = ?').get(videoId) as VideoRecord | undefined;
}

export function getVideosByStatus(status: VideoStatus): VideoRecord[] {
  return getDb().prepare('SELECT * FROM videos WHERE status = ?').all(status) as VideoRecord[];
}

export function getRetryableVideos(): VideoRecord[] {
  return getDb().prepare(`
    SELECT * FROM videos
    WHERE status IN ('translation_timeout', 'translation_error', 'translation_malformed', 'no_transcript')
    AND retry_count < ?
  `).all(3) as VideoRecord[];
}

export function updateVideoStatus(videoId: string, status: VideoStatus, extra?: Record<string, unknown>): void {
  const sets = ['status = ?'];
  const params: unknown[] = [status];

  if (extra) {
    for (const [key, value] of Object.entries(extra)) {
      sets.push(`${key} = ?`);
      params.push(value === null ? null : typeof value === 'object' ? JSON.stringify(value) : value);
    }
  }

  params.push(videoId);
  getDb().prepare(`UPDATE videos SET ${sets.join(', ')} WHERE video_id = ?`).run(...params);
}

export function incrementRetryCount(videoId: string): void {
  getDb().prepare('UPDATE videos SET retry_count = retry_count + 1 WHERE video_id = ?').run(videoId);
}

export function resetRetryCount(videoId: string): void {
  getDb().prepare('UPDATE videos SET retry_count = 0 WHERE video_id = ?').run(videoId);
}

export function markPermanentlyFailed(videoId: string): void {
  updateVideoStatus(videoId, 'permanently_failed');
}

export function getQuotaUsedToday(): number {
  const today = new Date().toISOString().split('T')[0];
  const row = getDb().prepare('SELECT units_used FROM quota_usage WHERE date = ?').get(today) as { units_used: number } | undefined;
  return row?.units_used ?? 0;
}

export function addQuotaUsage(units: number): void {
  const today = new Date().toISOString().split('T')[0];
  getDb().prepare(`
    INSERT INTO quota_usage (date, units_used) VALUES (?, ?)
    ON CONFLICT(date) DO UPDATE SET units_used = units_used + ?
  `).run(today, units, units);
}

export function getAllVideos(): VideoRecord[] {
  return getDb().prepare('SELECT * FROM videos ORDER BY created_at DESC').all() as VideoRecord[];
}

export function deleteVideo(videoId: string): boolean {
  const result = getDb().prepare('DELETE FROM videos WHERE video_id = ?').run(videoId);
  getDb().prepare('DELETE FROM twitter_posts WHERE video_id = ?').run(videoId);
  return result.changes > 0;
}
