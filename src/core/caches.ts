/**
 * Per-request caches (upstream's static properties, like Ranks::$ranks or Clock::$advanced), which have to be
 * forgotten when the database is swapped: between tests, and when a saved game is loaded. A module registers how
 * to forget its cache with onReset().
 */
const resets: (() => void)[] = [];

export function onReset(forget: () => void): void {
    resets.push(forget);
}

export function resetCaches(): void {
    for (const forget of resets) forget();
}
