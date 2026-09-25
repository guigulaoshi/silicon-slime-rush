/** Full-route allowance at 10 m/s, including launch and corners; independent of turbo rate. */
export function driveBudgetGameSeconds(length: number, laps: number): number {
  return Math.max(360, length * laps / 10 + 30);
}
