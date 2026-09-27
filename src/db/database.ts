/**
 * Opening the database, and the schema it holds.
 *
 * One SQLite file per instance, `$LEGENDA_DIR/legenda.db`. The server is the only
 * long-lived writer, but `legenda token` opens the same file from another process while
 * it runs, so the file is in WAL mode with a busy timeout.
 *
 * Migrations are a numbered list applied in order and recorded in `user_version`.
 * Append to the list; never edit an entry that has shipped.
 */
import {Database} from 'bun:sqlite';
import {mkdirSync} from 'node:fs';
import {dirname} from 'node:path';

export const DB_FILE = 'legenda.db';

const MIGRATIONS: string[] = [
  `
  CREATE TABLE tokens (
    token    TEXT PRIMARY KEY,
    actor    TEXT NOT NULL,
    created  TEXT NOT NULL
  );

  CREATE TABLE sessions (id TEXT PRIMARY KEY, created TEXT NOT NULL);

  CREATE TABLE follows (
    id           TEXT PRIMARY KEY,
    source       TEXT NOT NULL,
    kind         TEXT NOT NULL,
    external_id  TEXT NOT NULL,
    title        TEXT NOT NULL,
    url          TEXT,
    status       TEXT NOT NULL,
    note         TEXT NOT NULL DEFAULT '',
    fetched_by   TEXT NOT NULL,
    screened     INTEGER NOT NULL DEFAULT 0,
    cursor       TEXT,
    added        TEXT NOT NULL,
    last_checked TEXT,
    last_error   TEXT,
    UNIQUE (source, kind, external_id)
  );

  CREATE TABLE items (
    id                   TEXT PRIMARY KEY,
    source               TEXT NOT NULL,
    external_id          TEXT NOT NULL,
    url                  TEXT NOT NULL,
    title                TEXT NOT NULL,
    creator              TEXT NOT NULL,
    creator_external_id  TEXT,
    container            TEXT,
    published            TEXT,
    length_minutes       INTEGER,
    thumbnail            TEXT,
    abstract             TEXT,
    summary              TEXT,
    extra                TEXT NOT NULL DEFAULT '{}',
    origin               TEXT NOT NULL,
    follow_id            TEXT REFERENCES follows(id),
    added_by             TEXT NOT NULL,
    reason               TEXT,
    state                TEXT NOT NULL,
    added                TEXT NOT NULL,
    changed              TEXT NOT NULL,
    version              INTEGER NOT NULL DEFAULT 1,
    -- Beyond the plan's schema: which curator run added it, for the Curator page and
    -- the per-creator-per-run limit.
    run_id               TEXT,
    UNIQUE (source, external_id)
  );
  CREATE INDEX items_by_state ON items(state, added);
  CREATE INDEX items_by_run ON items(run_id);

  CREATE TABLE intake (
    id         TEXT PRIMARY KEY,
    follow_id  TEXT NOT NULL REFERENCES follows(id),
    item       TEXT NOT NULL,
    seen       TEXT NOT NULL,
    decided    TEXT,
    decided_at TEXT
  );

  CREATE TABLE feedback (
    id         TEXT PRIMARY KEY,
    item_id    TEXT REFERENCES items(id),
    follow_id  TEXT REFERENCES follows(id),
    kind       TEXT NOT NULL,
    note       TEXT NOT NULL DEFAULT '',
    actor      TEXT NOT NULL,
    at         TEXT NOT NULL
  );
  CREATE INDEX feedback_by_time ON feedback(at);

  CREATE TABLE interests (
    id        TEXT PRIMARY KEY,
    topic     TEXT NOT NULL,
    strength  TEXT NOT NULL,
    sources   TEXT NOT NULL DEFAULT '[]',
    note      TEXT NOT NULL DEFAULT '',
    added     TEXT NOT NULL
  );

  CREATE TABLE profile_versions (
    version   INTEGER PRIMARY KEY,
    body      TEXT NOT NULL,
    actor     TEXT NOT NULL,
    note      TEXT NOT NULL DEFAULT '',
    at        TEXT NOT NULL
  );

  CREATE TABLE agent_runs (
    id           TEXT PRIMARY KEY,
    actor        TEXT NOT NULL,
    started      TEXT NOT NULL,
    finished     TEXT,
    outcome      TEXT,
    queries      TEXT NOT NULL DEFAULT '[]',
    considered   INTEGER NOT NULL DEFAULT 0,
    suggested    INTEGER NOT NULL DEFAULT 0,
    from_follows INTEGER NOT NULL DEFAULT 0,
    summary      TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE events (
    seq       INTEGER PRIMARY KEY AUTOINCREMENT,
    at        TEXT NOT NULL,
    actor     TEXT NOT NULL,
    entity    TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    change    TEXT NOT NULL
  );

  CREATE TABLE api_usage (
    day     TEXT NOT NULL,
    source  TEXT NOT NULL,
    units   INTEGER NOT NULL,
    PRIMARY KEY (day, source)
  );

  CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `,
];

export interface OpenOptions {
  busyTimeoutMs?: number;
}

/** Open (creating if need be) and bring the schema up to date. `:memory:` works for tests. */
export function openDatabase(path: string, options: OpenOptions = {}): Database {
  if (path !== ':memory:') mkdirSync(dirname(path), {recursive: true});
  const db = new Database(path, {create: true, strict: true});
  db.exec('PRAGMA journal_mode = WAL');
  db.exec(`PRAGMA busy_timeout = ${Math.max(0, Math.floor(options.busyTimeoutMs ?? 5000))}`);
  db.exec('PRAGMA foreign_keys = ON');
  migrate(db);
  return db;
}

export const SCHEMA_VERSION = MIGRATIONS.length;

function migrate(db: Database): void {
  const current = (db.query('PRAGMA user_version').get() as {user_version: number}).user_version;
  for (let version = current; version < MIGRATIONS.length; version++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[version]!);
      db.exec(`PRAGMA user_version = ${version + 1}`);
    }).immediate();
  }
}
