/**
 * Schema changes for games saved by earlier versions, oldest first. A new database is made from schema.sql (the
 * current schema) and marked with the latest version; one saved earlier runs the migrations it hasn't had.
 *
 * When upstream changes its schema: rerun `npm run schema` (a new game gets the new schema.sql) AND add a migration
 * here that makes the same change to an existing game (ALTER TABLE ... ADD COLUMN, CREATE TABLE ..., seed rows).
 * MIGRATIONS[0] takes a database from version 1 to 2, and so on.
 */
import type { Db } from './Db';

export const MIGRATIONS: ((db: Db) => void)[] = [];
