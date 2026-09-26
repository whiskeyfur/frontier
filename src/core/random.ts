/**
 * Randomness for the game, in one place so tests can load the dice: setRandom(() => 0) makes every roll the lowest.
 * PHP's random_int, mt_rand, array_rand, shuffle and SQL's RAND() all draw from it.
 */
let source: () => number = Math.random;

/** A number in [0, 1). */
export function random(): number {
    return source();
}

export function setRandom(fn: (() => number) | null): void {
    source = fn ?? Math.random;
}

/** A sequence of rolls (each in [0, 1)), repeated from the start when it runs out. */
export function sequence(...rolls: number[]): () => number {
    let i = 0;
    return () => rolls[i++ % rolls.length];
}
