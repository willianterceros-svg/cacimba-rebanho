export function createFakeIndexedDB(hooks = {}) {
  const stores = new Map();
  const later = fn => setTimeout(fn, 1);

  function request(run) {
    const req = { onsuccess: null, onerror: null, result: undefined };
    later(async () => {
      try {
        req.result = await run();
        req.onsuccess?.();
      } catch (error) {
        req.error = error;
        req.onerror?.();
      }
    });
    return req;
  }

  const db = {
    objectStoreNames: { contains: name => stores.has(name) },
    createObjectStore: (name, { keyPath }) => stores.set(name, { keyPath, rows: new Map() }),
    close() {},
    transaction(names) {
      const allowed = Array.isArray(names) ? names : [names];
      const tx = { oncomplete: null, onerror: null, onabort: null };
      let open = 0;
      const finish = () => { if (--open === 0) later(() => tx.oncomplete?.()); };
      tx.objectStore = name => {
        if (!allowed.includes(name)) throw new Error(`store fora da transação: ${name}`);
        const store = stores.get(name);
        const track = run => { open++; return request(async () => { const result = await run(); finish(); return result; }); };
        return {
          getAll: () => track(async () => {
            const hook = hooks[`getAll:${name}`];
            if (hook) { hooks[`getAll:${name}`] = null; await hook(); }
            return [...store.rows.values()].map(value => structuredClone(value));
          }),
          get: key => track(async () => structuredClone(store.rows.get(key))),
          put: value => track(async () => { store.rows.set(value[store.keyPath], structuredClone(value)); }),
          delete: key => track(async () => { store.rows.delete(key); })
        };
      };
      later(() => { if (open === 0) tx.oncomplete?.(); });
      return tx;
    }
  };

  return {
    open() {
      const req = { onsuccess: null, onerror: null, onupgradeneeded: null, result: db };
      later(() => { req.onupgradeneeded?.({ target: { result: db } }); req.onsuccess?.(); });
      return req;
    }
  };
}
