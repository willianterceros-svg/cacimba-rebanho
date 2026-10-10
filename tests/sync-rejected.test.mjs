import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { createFakeIndexedDB } from "./fake-indexeddb.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = path => readFileSync(resolve(root, path), "utf8");
const plain = value => JSON.parse(JSON.stringify(value));

function syncContext({ role = "FIELD", outbox, servers = {}, pushError = "ROLE_DENIED" }) {
  const calls = { updated: [], discarded: [], reloaded: 0 };
  const context = vm.createContext({
    structuredClone, console,
    currentUser: { role },
    sessionToken: "token",
    navigator: { onLine: true },
    applySnapshot: () => {}, migrateReproducers: () => {}, rebuildPedigreeLibrary: () => {}, refreshAllViews: () => {},
    RebanhoData: {
      sameData: (left, right) => JSON.stringify(left) === JSON.stringify(right),
      pendingOutbox: async () => outbox,
      updateOutbox: async item => calls.updated.push(item),
      archiveRejectedOutbox: async () => { throw new Error("não deveria arquivar"); },
      discardOutboxBatch: async (...args) => calls.discarded.push(args),
      loadStable: async () => { calls.reloaded++; return {}; }
    },
    RebanhoApi: {
      configured: () => true,
      rpc: async (name, params) => {
        if (name === "rebanho_push_changes") return { ok: false, error: pushError };
        return { ok: true, contexts: params.p_items.map(item => ({ entity: item.entity, uid: item.uid, server: servers[`${item.entity}:${item.uid}`] || null })) };
      }
    }
  });
  vm.runInContext(read("src/sync.js"), context);
  return { context, calls };
}

const birth = { entity: "animals", operation: "insert", uid: "u_F421", baseVersion: 0, data: { id: "F421", origin: "Nascimento" } };

test("recusa definitiva do servidor marca o lote como recusado", async () => {
  for (const [error, rejected] of [["ROLE_DENIED", true], ["DUPLICATE_VALUE", true], ["INVALID_SESSION", false], [null, false]]) {
    const { context, calls } = syncContext({ role: "OWNER", outbox: [{ id: "b1", changes: [birth] }], pushError: error });
    const result = await vm.runInContext("RebanhoSync.pushPending()", context);
    assert.equal(calls.updated[0].rejected, rejected, String(error));
    assert.equal(result.rejected, rejected, String(error));
    assert.equal(calls.updated[0].conflict, false);
  }
});

test("revisão do lote recusado compara cada mudança com a nuvem", async () => {
  const kept = { uid: "u_A", id: "A" };
  const outbox = [
    { id: "ok", changes: [birth] },
    { id: "b1", rejected: true, lastError: "ROLE_DENIED", createdAt: "2026-10-10T12:42:13.477Z", changes: [
      { entity: "animals", operation: "delete", uid: "u_A", baseVersion: 1, baseData: kept, data: kept },
      { entity: "animals", operation: "delete", uid: "u_B", baseVersion: 1, baseData: { id: "B" }, data: { id: "B" } },
      { entity: "animals", operation: "update", uid: "u_C", baseVersion: 1, data: { id: "C", status: "MORTO" } },
      birth
    ] }
  ];
  const servers = {
    "animals:u_A": { uid: "u_A", version: 1, data: kept, deleted_at: null },
    "animals:u_B": { uid: "u_B", version: 2, data: { id: "B" }, deleted_at: "2026-10-10T13:00:00.000Z" },
    "animals:u_C": { uid: "u_C", version: 2, data: { id: "C", status: "ATIVO" }, deleted_at: null }
  };
  const { context } = syncContext({ outbox, servers });

  const review = plain(await vm.runInContext("RebanhoSync.reviewRejected()", context));

  assert.equal(review.batchId, "b1");
  assert.equal(review.error, "ROLE_DENIED");
  assert.deepEqual(review.items.map(item => item.cloud), ["same", "deleted", "different", "missing"]);
});

test("sem lote recusado a revisão não consulta a nuvem", async () => {
  const { context } = syncContext({ outbox: [{ id: "b1", conflict: true, changes: [birth] }] });
  assert.equal(await vm.runInContext("RebanhoSync.reviewRejected()", context), null);
});

test("descartar lote recusado grava a cópia da nuvem e remove o que só existe no aparelho", async () => {
  const kept = { uid: "u_A", id: "A" };
  const server = { uid: "u_A", version: 1, data: kept, deleted_at: null };
  const batch = { id: "b1", rejected: true, lastError: "ROLE_DENIED", changes: [
    { entity: "animals", operation: "delete", uid: "u_A", baseVersion: 1, baseData: kept, data: kept },
    birth
  ] };
  const { context, calls } = syncContext({ outbox: [batch], servers: { "animals:u_A": server } });

  const result = plain(await vm.runInContext('RebanhoSync.discardRejected("b1")', context));

  assert.deepEqual(result, { ok: true });
  assert.equal(calls.discarded.length, 1);
  const [discardedBatch, items, reason] = calls.discarded[0];
  assert.equal(discardedBatch.id, "b1");
  assert.equal(reason, "ROLE_DENIED");
  assert.deepEqual(plain(items), [
    { entity: "animals", record: server },
    { entity: "animals", uid: "u_F421", remove: true }
  ]);
  assert.equal(calls.reloaded, 1);
});

test("descartar recusa lote que não está marcado como recusado", async () => {
  const { context, calls } = syncContext({ outbox: [{ id: "b1", conflict: true, changes: [birth] }] });
  const result = plain(await vm.runInContext('RebanhoSync.discardRejected("b1")', context));
  assert.deepEqual(result, { ok: false, missing: true });
  assert.equal(calls.discarded.length, 0);
});

test("banco local conta lotes recusados e descarta guardando cópia no arquivo", async () => {
  const context = vm.createContext({ structuredClone, setTimeout, queueMicrotask, crypto: globalThis.crypto, indexedDB: createFakeIndexedDB(), console });
  vm.runInContext(`var currentUser = { role: "FIELD" }; ${read("src/database.js")}`, context);
  const run = code => vm.runInContext(code, context);
  await run('RebanhoData.updateOutbox({ id: "b1", createdAt: "2026-10-10T12:00:00.000Z", rejected: true, lastError: "ROLE_DENIED", changes: [{ entity: "animals", operation: "insert", uid: "u_X", data: { id: "X" } }] })');
  await run('RebanhoData.updateOutbox({ id: "b2", createdAt: "2026-10-10T12:01:00.000Z", changes: [] })');

  assert.equal((await run("RebanhoData.status()")).rejected, 1);

  await run('RebanhoData.pendingOutbox().then(list => RebanhoData.discardOutboxBatch(list[0], [{ entity: "animals", uid: "u_X", remove: true }], "ROLE_DENIED"))');
  const status = await run("RebanhoData.status()");
  const archived = plain(await run("RebanhoData.archivedOutbox()"));
  assert.equal(status.pending, 1);
  assert.equal(status.rejected, 0);
  assert.equal(archived.length, 1);
  assert.equal(archived[0].batch.id, "b1");
  assert.equal(archived[0].discardedByUser, true);
});

test("tela de lote recusado está ligada à conta e ao status da sincronização", () => {
  const html = read("index.html");
  const sync = read("src/sync.js");
  assert.match(html, /id="rejectedReviewBtn" class="btn secondary hidden" onclick="openRejectedReview\(\)"/);
  assert.match(html, /id="rejectedReviewOverlay"/);
  assert.match(html, /id="discardRejectedBtn"[^>]*onclick="confirmDiscardRejected\(\)"/);
  assert.match(sync, /rejectedButton\.classList\.toggle\("hidden", status\.rejected === 0\)/);
});

test("aviso de descarte conta como perda toda inclusão ou alteração que não está igual na nuvem", () => {
  const { context } = syncContext({ outbox: [] });
  const loses = item => vm.runInContext(`rejectedItemLoses(${JSON.stringify(item)})`, context);
  for (const operation of ["insert", "update"]) {
    assert.equal(loses({ operation, cloud: "missing" }), true, operation);
    assert.equal(loses({ operation, cloud: "different" }), true, operation);
    assert.equal(loses({ operation, cloud: "deleted" }), true, operation);
    assert.equal(loses({ operation, cloud: "same" }), false, operation);
  }
  for (const cloud of ["missing", "different", "deleted", "same"]) {
    assert.equal(loses({ operation: "delete", cloud }), false, cloud);
  }
});

test("tela de lote recusado usa a mesma regra de perda no aviso e no destaque", () => {
  const sync = read("src/sync.js");
  assert.match(sync, /const lost = review\.items\.filter\(rejectedItemLoses\)\.length;/);
  assert.match(sync, /state\.className = rejectedItemLoses\(item\) \? "rejected-loss" : "muted";/);
});
