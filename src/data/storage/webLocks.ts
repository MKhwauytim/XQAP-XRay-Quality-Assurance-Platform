type LockManagerLike = {
  request: (
    name: string,
    options: { mode: "exclusive" },
    callback: () => Promise<unknown>
  ) => Promise<unknown>;
};

function getNativeLockManager(): LockManagerLike | null {
  const nav = globalThis.navigator as Navigator & {
    locks?: LockManagerLike;
  };
  return nav?.locks ?? null;
}

// Fallback: one promise chain per resource name, serializing within this thread.
const fallbackChains = new Map<string, Promise<unknown>>();

async function withFallbackLock<T>(
  name: string,
  callback: () => Promise<T>
): Promise<T> {
  const previous = fallbackChains.get(name) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  fallbackChains.set(
    name,
    previous.then(() => gate)
  );

  await previous.catch(() => undefined);
  try {
    return await callback();
  } finally {
    release();
    // Drop the chain entry if no one queued behind us.
    if (fallbackChains.get(name) === previous.then(() => gate)) {
      fallbackChains.delete(name);
    }
  }
}

export async function withResourceLock<T>(
  resourceName: string,
  callback: () => Promise<T>
): Promise<T> {
  const manager = getNativeLockManager();
  if (!manager) {
    return withFallbackLock(resourceName, callback);
  }

  return manager.request(
    `xray:${resourceName}`,
    { mode: "exclusive" },
    callback as () => Promise<unknown>
  ) as Promise<T>;
}
