// Node exposes a bare localStorage global that shadows the one jsdom installs.
// It is a plain object with no getItem, setItem or clear, so any test touching
// storage fails with "localStorage.clear is not a function". Replace it with a
// small in-memory Storage when the real methods are missing.

function createStorage() {
  let store = new Map()

  return {
    get length() {
      return store.size
    },
    key(index) {
      return [...store.keys()][index] ?? null
    },
    getItem(key) {
      const name = String(key)
      return store.has(name) ? store.get(name) : null
    },
    setItem(key, value) {
      store.set(String(key), String(value))
    },
    removeItem(key) {
      store.delete(String(key))
    },
    clear() {
      store = new Map()
    },
  }
}

// Tests that opt out of jsdom have no window, so fall back to globalThis.
const target = typeof window === 'undefined' ? globalThis : window

for (const name of ['localStorage', 'sessionStorage']) {
  if (typeof target[name]?.clear !== 'function') {
    Object.defineProperty(target, name, {
      configurable: true,
      writable: true,
      value: createStorage(),
    })
  }
}
