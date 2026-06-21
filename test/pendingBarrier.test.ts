import { describe, expect, it } from "vitest";

import { PendingBarrier } from "../src/services/pendingBarrier";

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const flush = () => Promise.resolve().then(() => undefined);

describe("PendingBarrier", () => {
  it("tracks an op and removes it once settled", async () => {
    const barrier = new PendingBarrier();
    const d = deferred();
    const tracked = barrier.track(d.promise);
    expect(barrier.size).toBe(1);

    d.resolve();
    await tracked;
    await flush(); // let the internal finally run
    expect(barrier.size).toBe(0);
  });

  it("settle() blocks until the in-flight op resolves", async () => {
    const barrier = new PendingBarrier();
    const d = deferred();
    barrier.track(d.promise);

    let done = false;
    const settling = barrier.settle().then(() => {
      done = true;
    });

    await flush();
    expect(done).toBe(false); // still waiting on the op

    d.resolve();
    await settling;
    expect(done).toBe(true);
  });

  it("settle() also waits for ops queued while it is already waiting", async () => {
    const barrier = new PendingBarrier();
    const first = deferred();
    barrier.track(first.promise);

    let done = false;
    const settling = barrier.settle().then(() => {
      done = true;
    });

    // A second save lands while settle() is mid-wait.
    const second = deferred();
    barrier.track(second.promise);
    first.resolve();
    await flush();
    await flush();
    expect(done).toBe(false); // the newly queued op must still be awaited

    second.resolve();
    await settling;
    expect(done).toBe(true);
  });

  it("settle() resolves even if a tracked op rejects", async () => {
    const barrier = new PendingBarrier();
    const d = deferred();
    barrier.track(d.promise);

    const settling = barrier.settle();
    d.reject(new Error("embedding failed"));
    await expect(settling).resolves.toBeUndefined();
    expect(barrier.size).toBe(0);
  });

  it("settle() resolves immediately when nothing is pending", async () => {
    const barrier = new PendingBarrier();
    await expect(barrier.settle()).resolves.toBeUndefined();
  });
});
