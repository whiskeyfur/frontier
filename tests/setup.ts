// Runs before each test file: loads SQLite once, and before each test gives the game a fresh database (see
// tests/TestCase.ts), as upstream's TestCase::setUp does.
import { beforeEach } from 'vitest';
import { freshDatabase } from './TestCase';

beforeEach(async () => {
    await freshDatabase();
});
