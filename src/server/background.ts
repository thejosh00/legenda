/**
 * What the server does on its own: poll follows as they fall due, expire stale intake,
 * and take the daily backup. Returns a function that stops it all.
 */
import {dailyBackup} from '../db/backup.ts';
import {Ctx, type AppDeps} from '../db/context.ts';
import {expireIntake} from '../db/intake.ts';
import {pollAll, POLLER_ACTOR} from '../db/poll.ts';

export interface BackgroundOptions {
  dataDir: string;
  log: (line: string) => void;
}

const TICK_MS = 5 * 60_000;
const BACKUP_CHECK_MS = 60 * 60_000;

export function startBackground(deps: AppDeps, options: BackgroundOptions): () => void {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const results = await pollAll(deps, {onlyDue: true});
      for (const r of results) {
        if (r.error !== null) options.log(`${deps.now()} poll ${r.title}: ${r.error}`);
        else if (r.added + r.offered > 0) options.log(`${deps.now()} poll ${r.title}: ${r.added} added, ${r.offered} offered`);
      }
      expireIntake(new Ctx(deps, POLLER_ACTOR));
    } catch (error) {
      options.log(`${deps.now()} background: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      running = false;
    }
  };
  const backup = () => {
    try {
      const path = dailyBackup(deps.db, options.dataDir, new Date(deps.now()));
      if (path !== undefined) options.log(`${deps.now()} backed up to ${path}`);
    } catch (error) {
      // Reported, never fatal: a full disk must not take the list down with it.
      options.log(`${deps.now()} backup failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  backup();
  const first = setTimeout(tick, 5_000);
  const timer = setInterval(tick, TICK_MS);
  const backupTimer = setInterval(backup, BACKUP_CHECK_MS);
  return () => {
    clearTimeout(first);
    clearInterval(timer);
    clearInterval(backupTimer);
  };
}
