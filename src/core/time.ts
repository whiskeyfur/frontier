/**
 * The real clock, in UTC, which tests can stop or move. Everything that asks "what day is it?" comes here: the PHP
 * helpers (time, gmdate, strtotime) and the SQL functions (UTC_DATE, UTC_TIMESTAMP...).
 */
let fixed: number | null = null;
let offsetMs = 0;

/** Milliseconds since the epoch. */
export function nowMs(): number {
    return (fixed ?? Date.now()) + offsetMs;
}

/** Stops the clock at a moment ('YYYY-MM-DD HH:MM:SS' UTC, or ms), or lets it run again (null). */
export function setNow(when: string | number | null): void {
    offsetMs = 0;
    fixed = when === null ? null : typeof when === 'number' ? when : Date.parse(when.replace(' ', 'T') + (when.length <= 10 ? 'T00:00:00Z' : 'Z'));
}

/** Moves the clock by some milliseconds. */
export function shiftNow(ms: number): void {
    offsetMs += ms;
}
