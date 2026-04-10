// Shared helpers for user route modules.

export const DO_CALL_TIMEOUT_MS = 5000;

export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    promise,
    new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error('DO call timed out')), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}
