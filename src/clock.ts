import { DateTime } from 'luxon';
import { config } from './config.js';

/**
 * Returns current DateTime instance, respecting NOW_OVERRIDE when set (for tests & evals).
 */
export function getNow(tz: string = 'Asia/Kolkata'): DateTime {
  const override = process.env.NOW_OVERRIDE || config.NOW_OVERRIDE;
  if (override && override.trim()) {
    const parsed = DateTime.fromISO(override.trim(), { zone: tz });
    if (parsed.isValid) {
      return parsed;
    }
  }
  return DateTime.now().setZone(tz);
}

/**
 * Formats time for prompt injection: "Wed 11 Nov 2026, 14:05 Asia/Kolkata"
 */
export function formatLocalForModel(dt: DateTime): string {
  // EEE d MMM yyyy, HH:mm
  return `${dt.toFormat('EEE d MMM yyyy, HH:mm')} ${dt.zoneName}`;
}

/**
 * Formats date for display: "11 Nov 2026"
 */
export function formatDisplayDate(dt: DateTime): string {
  return dt.toFormat('d MMM yyyy');
}

/**
 * Formats timestamp as UTC ISO string for persistence.
 */
export function toUtcIso(dt: DateTime): string {
  return dt.toUTC().toISO() || new Date().toISOString();
}

