/**
 * Spacing requests to an API that asks for it (arXiv: one request per three seconds).
 *
 * One set of gates per server, shared by every request and the poller. The clock and
 * the sleep are injected so tests check the spacing without waiting.
 */
export class RateGates {
  private readonly next = new Map<string, number>();
  private chain: Promise<void> = Promise.resolve();

  constructor(
    private readonly clockMs: () => number = () => Date.now(),
    private readonly sleep: (ms: number) => Promise<void> = ms => new Promise(resolve => setTimeout(resolve, ms)),
  ) {}

  /** Resolve when a request to `name` may go, at least `intervalMs` after the last one. */
  wait(name: string, intervalMs: number): Promise<void> {
    const turn = this.chain.then(async () => {
      const now = this.clockMs();
      const at = this.next.get(name) ?? 0;
      if (at > now) await this.sleep(at - now);
      this.next.set(name, Math.max(now, at) + intervalMs);
    });
    this.chain = turn.catch(() => {});
    return turn;
  }
}
