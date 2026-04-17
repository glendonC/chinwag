// Tiny TTL cache for the team-wide context payload.
//
// TeamDO keeps the most recent successful queryTeamContext() result in
// memory so follow-up reads inside the TTL window skip the SQL round trip.
// The cache has to be busted on every writer path that changes team state,
// so the shape is small on purpose: get, set, invalidate.

export class ContextCache<T> {
  #value: T | null = null;
  #expireAt = 0;

  constructor(private readonly ttlMs: number) {}

  get(): T | null {
    return this.#value && Date.now() < this.#expireAt ? this.#value : null;
  }

  set(value: T): void {
    this.#value = value;
    this.#expireAt = Date.now() + this.ttlMs;
  }

  invalidate(): void {
    this.#value = null;
    this.#expireAt = 0;
  }
}
