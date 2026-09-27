/**
 * Reading and writing an instance's settings.
 */
import type {Database} from 'bun:sqlite';
import {AppError, EXIT_USAGE} from '../core/errors.ts';
import {REDACTED, SETTINGS, parseEnabledSources, settingSpec} from '../core/settings.ts';
import type {SourceId} from '../core/types.ts';

/** The stored value, or the default. Secrets included — never send this to a client. */
export function getSetting(db: Database, key: string): string | undefined {
  const row = db.query('SELECT value FROM settings WHERE key = ?').get(key) as {value: string} | null;
  return row?.value ?? settingSpec(key)?.default;
}

export function numberSetting(db: Database, key: string): number {
  const value = Number(getSetting(db, key));
  if (!Number.isFinite(value)) throw new Error(`setting ${key} is not a number`);
  return value;
}

export function boolSetting(db: Database, key: string): boolean {
  return getSetting(db, key) === 'true';
}

export function enabledSources(db: Database): SourceId[] {
  return parseEnabledSources(getSetting(db, 'enabled_sources'));
}

export function setSetting(db: Database, key: string, value: string | null): void {
  const spec = settingSpec(key);
  if (spec === undefined) throw new AppError(`no setting called "${key}"; run "legenda settings" for the list`, EXIT_USAGE);
  if (value === null || value.trim() === '') {
    db.query('DELETE FROM settings WHERE key = ?').run(key);
    return;
  }
  const clean = value.trim();
  const problem = spec.validate?.(clean);
  if (problem !== undefined) throw new AppError(`${key} ${problem}`, EXIT_USAGE);
  db.query('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, clean);
}

export interface SettingJson {
  key: string;
  value: string | null;
  default: string | null;
  is_set: boolean;
  secret: boolean;
  summary: string;
}

/** A setting as a client may see it: secrets say whether they are set, never what. */
export function settingJson(db: Database, key: string): SettingJson {
  const spec = settingSpec(key);
  if (spec === undefined) throw new AppError(`no setting called "${key}"`, EXIT_USAGE);
  const row = db.query('SELECT value FROM settings WHERE key = ?').get(key) as {value: string} | null;
  const stored = row?.value;
  return {
    key,
    value: spec.secret === true ? (stored === undefined ? null : REDACTED) : (stored ?? spec.default ?? null),
    default: spec.secret === true ? null : (spec.default ?? null),
    is_set: stored !== undefined,
    secret: spec.secret === true,
    summary: spec.summary,
  };
}

export function allSettingsJson(db: Database): SettingJson[] {
  const perSource = (db.query("SELECT key FROM settings WHERE key LIKE 'daily_suggestion_cap.%'").all() as Array<{key: string}>).map(r => r.key);
  return [...Object.keys(SETTINGS), ...perSource].map(key => settingJson(db, key));
}
