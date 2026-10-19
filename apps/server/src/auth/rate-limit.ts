/** 进程内固定窗口计数器，单实例部署足够；多实例时再换成数据库或 Redis。 */
export class RateLimiter {
  private readonly windows = new Map<string, { count: number; resetAt: number }>();

  public constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  public isLimited(key: string, now: Date): boolean {
    const window = this.windows.get(key);
    return (
      window !== undefined && window.resetAt > now.getTime() && window.count >= this.limit
    );
  }

  public hit(key: string, now: Date): void {
    const window = this.windows.get(key);
    if (window === undefined || window.resetAt <= now.getTime()) {
      this.windows.set(key, { count: 1, resetAt: now.getTime() + this.windowMs });
      this.prune(now);
      return;
    }
    window.count += 1;
  }

  public reset(key: string): void {
    this.windows.delete(key);
  }

  private prune(now: Date): void {
    for (const [key, window] of this.windows) {
      if (window.resetAt <= now.getTime()) {
        this.windows.delete(key);
      }
    }
  }
}
