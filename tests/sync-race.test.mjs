import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { createFakeIndexedDB } from "./fake-indexeddb.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = path => readFileSync(resolve(root, path), "utf8");
const settle = () => new Promise(done => setTimeout(done, 30));

async function createDevice(role, hooks = {}) {
  const context = vm.createContext({
    structuredClone, setTimeout, queueMicrotask, crypto: globalThis.crypto,
    indexedDB: createFakeIndexedDB(hooks), alert: () => {}, console
  });
  vm.runInContext(`
    var currentUser = { role: ${JSON.stringify(role)}, name: "Renato", login: "renatoa", uid: "r1" };
    var herd = [], movementEvents = [], history = [], reproducers = [], historicalDams = [], pedigreeLibrary = [];
    function localSnapshot() { return { schemaVersion: 5, herd, history, reproducers, movementEvents, historicalDams, pedigreeLibrary }; }
    function applySnapshot(snapshot) {
      herd = snapshot.herd; movementEvents = snapshot.movementEvents; history = snapshot.history;
      reproducers = snapshot.reproducers; historicalDams = snapshot.historicalDams; pedigreeLibrary = snapshot.pedigreeLibrary;
    }
    ${read("src/database.js")}
    globalThis.registerBirth = id => {
      herd.push({ uid: "u_" + id, id, origin: "Nascimento", mother: "824" });
      movementEvents.push({ eventUid: "mov_" + id, type: "birth", animalUid: "u_" + id, id });
      history.unshift({ uid: "hist_" + id, msg: "Nascimento registrado: " + id });
      RebanhoData.scheduleCapture(() => localSnapshot());
    };
    globalThis.memory = () => ({ herd: herd.map(animal => animal.id), moves: movementEvents.map(event => event.id) });
    globalThis.animal = uid => herd.find(item => item.uid === uid) || null;
  `, context);
  const run = code => vm.runInContext(code, context);
  await run("RebanhoData.open()");
  return { context, run };
}

async function outboxOperations(run) {
  const outbox = await run("RebanhoData.pendingOutbox()");
  return outbox.flatMap(batch => batch.changes.map(change => `${change.operation} ${change.entity} ${change.uid}`));
}

async function reloadInto(context, run) {
  await run("RebanhoData.loadStable(applySnapshot)");
  await run("RebanhoData.captureNow()");
}

async function deviceWith(role) {
  const hooks = {};
  const { context, run } = await createDevice(role, hooks);
  run('registerBirth("F084")');
  await settle();
  await run("RebanhoData.captureNow()");
  hooks["getAll:history"] = async () => {
    run('registerBirth("F085")');
    await settle();
  };
  return { context, run };
}

async function reloadDuringBirth(role, loader) {
  const { context, run } = await deviceWith(role);
  if (loader === "loadStable") await run("RebanhoData.loadStable(applySnapshot)");
  else {
    context.loaded = await run("RebanhoData.loadAfterLogin()");
    run("applySnapshot(loaded)");
  }
  await run("RebanhoData.captureNow()");
  const outbox = await run("RebanhoData.pendingOutbox()");
  return {
    memory: JSON.parse(JSON.stringify(run("memory()"))),
    operations: outbox.flatMap(batch => batch.changes.map(change => `${change.operation} ${change.entity} ${change.uid}`))
  };
}

test("recarga da sincronização não perde nascimento lançado durante a leitura do banco local", async () => {
  for (const role of ["OWNER", "ADMIN", "FIELD"]) {
    const { memory, operations } = await reloadDuringBirth(role, "loadStable");
    assert.deepEqual(memory.herd, ["F084", "F085"], role);
    assert.deepEqual(memory.moves, ["F084", "F085"], role);
    assert.ok(operations.includes("insert animals u_F085"), role);
    assert.ok(operations.every(operation => !operation.startsWith("delete")), role);
  }
});

test("perfil de campo nunca transforma registro ausente da memória em exclusão", async () => {
  const { operations } = await reloadDuringBirth("FIELD", "loadAfterLogin");
  assert.ok(operations.includes("insert animals u_F085"));
  assert.ok(operations.every(operation => !operation.startsWith("delete")));
});

test("sincronização recarrega o estado local somente pelo carregamento estável", () => {
  const sync = read("src/sync.js");
  assert.ok((sync.match(/await RebanhoData\.loadStable\(applySnapshot\)/g) || []).length >= 3);
  assert.doesNotMatch(sync, /applySnapshot\(await RebanhoData\.loadStable/);
  assert.doesNotMatch(sync, /RebanhoData\.loadAfterLogin\(\)/);
});

async function deviceAfterFirstSync(role) {
  const device = await createDevice(role);
  device.run('herd.push({ uid: "u_A", id: "A", status: "ATIVO" }); RebanhoData.scheduleCapture(() => localSnapshot());');
  await settle();
  await device.run("RebanhoData.captureNow()");
  const batch = (await device.run("RebanhoData.pendingOutbox()"))[0];
  await device.run(`RebanhoData.removeOutbox(${JSON.stringify(batch.id)})`);
  return device;
}

test("recarga após o pull não desfaz nem reenvia alterações vindas de outro aparelho", async () => {
  for (const role of ["OWNER", "ADMIN", "FIELD"]) {
    const { context, run } = await deviceAfterFirstSync(role);
    await run(`RebanhoData.applyRemoteChanges([
      { entity: "animals", record: { uid: "u_A", data: { uid: "u_A", id: "A", status: "VENDIDO" }, version: 2 } },
      { entity: "animals", record: { uid: "u_B", data: { uid: "u_B", id: "B", status: "ATIVO" }, version: 1 } }
    ])`);

    await reloadInto(context, run);

    assert.deepEqual(await outboxOperations(run), [], role);
    assert.equal(run('animal("u_A").status'), "VENDIDO", role);
    assert.ok(run('animal("u_B")'), role);
  }
});

test("lançamento feito durante o pull continua sendo enviado sem desfazer o pull", async () => {
  const { context, run } = await deviceAfterFirstSync("OWNER");
  await run(`RebanhoData.applyRemoteChanges([
    { entity: "animals", record: { uid: "u_A", data: { uid: "u_A", id: "A", status: "VENDIDO" }, version: 2 } }
  ])`);
  run('registerBirth("F090")');

  await reloadInto(context, run);

  const operations = await outboxOperations(run);
  assert.ok(operations.includes("insert animals u_F090"));
  assert.ok(operations.every(operation => !operation.includes("u_A")), JSON.stringify(operations));
  assert.equal(run('animal("u_A").status'), "VENDIDO");
  assert.ok(run('animal("u_F090")'));
});

test("descartar lote recusado não volta a enfileirar o lote na recarga", async () => {
  const { context, run } = await deviceAfterFirstSync("FIELD");
  run('registerBirth("F091")');
  await settle();
  await run("RebanhoData.captureNow()");
  const batch = (await run("RebanhoData.pendingOutbox()"))[0];
  context.rejectedBatch = batch;
  context.discardItems = batch.changes.map(change => ({ entity: change.entity, uid: change.uid, remove: true }));

  await run('RebanhoData.discardOutboxBatch(rejectedBatch, discardItems, "DUPLICATE_VALUE")');
  await reloadInto(context, run);

  assert.deepEqual(await outboxOperations(run), []);
  assert.equal(run('animal("u_F091")'), null);
});

test("resolução de conflito com a versão da nuvem não é revertida pela recarga", async () => {
  const { context, run } = await deviceAfterFirstSync("OWNER");
  run('animal("u_A").status = "MORTO"; RebanhoData.scheduleCapture(() => localSnapshot());');
  await settle();
  await run("RebanhoData.captureNow()");
  context.conflictBatch = (await run("RebanhoData.pendingOutbox()"))[0];

  await run(`RebanhoData.resolveOutboxBatch(conflictBatch, [], [
    { entity: "animals", record: { uid: "u_A", data: { uid: "u_A", id: "A", status: "VENDIDO" }, version: 3, updated_at: "2026-10-10T12:00:00.000Z", deleted_at: null } }
  ])`);
  await reloadInto(context, run);

  assert.deepEqual(await outboxOperations(run), []);
  assert.equal(run('animal("u_A").status'), "VENDIDO");
});
