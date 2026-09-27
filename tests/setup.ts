/**
 * Loaded before every test file. Nothing a test runs may reach the real `~/.legenda`,
 * so the default data directory points somewhere disposable before any code reads it.
 */
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

process.env['LEGENDA_DIR'] = mkdtempSync(join(tmpdir(), 'legenda-guard-'));
delete process.env['LEGENDA_TOKEN'];
delete process.env['LEGENDA_URL'];
// Days are local. Not-UTC is what proves it.
process.env['TZ'] = 'America/Chicago';
