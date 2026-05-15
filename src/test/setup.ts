import "@testing-library/jest-dom/vitest";

type PromiseWithResolversShape = <T>() => {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
};

const PromiseWithResolvers = Promise as PromiseConstructor & {
  withResolvers?: PromiseWithResolversShape;
};

if (!PromiseWithResolvers.withResolvers) {
  PromiseWithResolvers.withResolvers = function withResolvers<T>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
}

class MockIntersectionObserver implements IntersectionObserver {
  readonly root: Element | Document | null = null;
  readonly rootMargin = "";
  readonly thresholds: ReadonlyArray<number> = [];

  disconnect() {
    return undefined;
  }

  observe() {
    return undefined;
  }

  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }

  unobserve() {
    return undefined;
  }
}

if (!globalThis.IntersectionObserver) {
  globalThis.IntersectionObserver = MockIntersectionObserver;
}

Object.defineProperty(globalThis, "scrollTo", {
  value: () => undefined,
  writable: true,
  configurable: true,
});

Object.defineProperty(window, "scrollTo", {
  value: () => undefined,
  writable: true,
  configurable: true,
});
