import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = path => readFileSync(resolve(root, path), "utf8");

test("comparação de registros ignora somente a ordem das propriedades", () => {
  const context = vm.createContext({ structuredClone });
  vm.runInContext(read("src/database.js"), context);

  assert.equal(vm.runInContext("RebanhoData.sameData({ uid: '1', data: { b: 2, a: 1 } }, { data: { a: 1, b: 2 }, uid: '1' })", context), true);
  assert.equal(vm.runInContext("RebanhoData.sameData({ uid: '1', data: { a: 1 } }, { uid: '1', data: { a: 2 } })", context), false);
  assert.equal(vm.runInContext("RebanhoData.sameData({ values: [1, 2] }, { values: [2, 1] })", context), false);
});

test("reconstrução da genealogia não renova updatedAt sem mudança real", () => {
  const context = vm.createContext({});
  vm.runInContext(`
    let pedigreeLibrary = [{ key: "touro", name: "Touro", sex: "M", father: "Pai", mother: "Mãe", source: "Cadastro de reprodutor Touro", updatedAt: "2026-01-01T00:00:00.000Z" }];
    let herd = [];
    let reproducers = [{ uid: "rep_1", name: "Touro", sex: "M", father: "Pai", mother: "Mãe" }];
    let historicalDams = [];
    ${read("src/genealogy.js")}
  `, context);

  vm.runInContext("rebuildPedigreeLibrary()", context);
  assert.equal(vm.runInContext("pedigreeLibrary[0].updatedAt", context), "2026-01-01T00:00:00.000Z");
});

test("normalização não recria nem remove campos de reprodutores atuais", () => {
  const context = vm.createContext({});
  vm.runInContext(`
    let pedigreeLibrary = [];
    let herd = [];
    let reproducers = [{ uid: "rep_1", name: "Touro", extra: "preservado" }];
    let historicalDams = [];
    const originalReproducer = reproducers[0];
    ${read("src/genealogy.js")}
  `, context);

  vm.runInContext("migrateReproducers()", context);
  assert.equal(vm.runInContext("reproducers[0] === originalReproducer", context), true);
  assert.equal(vm.runInContext("reproducers[0].extra", context), "preservado");
});

test("login e sincronização não executam migração persistente de vínculos", () => {
  assert.doesNotMatch(read("src/auth.js"), /migrateLegacyGenealogyLinks/);
  assert.doesNotMatch(read("src/sync.js"), /migrateLegacyGenealogyLinks/);
  assert.doesNotMatch(read("src/ui.js"), /function\s+migrateLegacyGenealogyLinks/);
});

function syncContext() {
  const canonicalize = value => {
    if (Array.isArray(value)) return value.map(canonicalize);
    if (!value || typeof value !== "object") return value;
    return Object.keys(value).sort().reduce((result, key) => { result[key] = canonicalize(value[key]); return result; }, {});
  };
  const context = vm.createContext({
    structuredClone,
    RebanhoData: { sameData: (left, right) => JSON.stringify(canonicalize(left)) === JSON.stringify(canonicalize(right)) }
  });
  vm.runInContext(read("src/sync.js"), context);
  return context;
}

test("merge em três vias combina genealogia local com campo remoto diferente", () => {
  const context = syncContext();
  const result = vm.runInContext(`RebanhoSync.mergeThreeWay(
    { father: null, notes: "original", updatedAt: "t0" },
    { father: "Touro A", notes: "original", updatedAt: "t1" },
    { father: "", notes: "corrigida na nuvem", updatedAt: "t2" }
  )`, context);

  assert.deepEqual([...result.conflicts], []);
  assert.deepEqual(JSON.parse(JSON.stringify(result.value)), { father: "Touro A", notes: "corrigida na nuvem", updatedAt: "t2" });
});

test("merge em três vias preserva conflito quando o mesmo campo diverge", () => {
  const context = syncContext();
  const result = vm.runInContext(`RebanhoSync.mergeThreeWay(
    { father: null, notes: "original" },
    { father: "Touro A", notes: "original" },
    { father: "Touro B", notes: "original" }
  )`, context);

  assert.deepEqual([...result.conflicts], ["father"]);
});

test("classificação rebasa uma genealogia local sobre alteração remota independente", () => {
  const context = syncContext();
  const result = vm.runInContext(`RebanhoSync.classifyChange(
    { entity: "animals", operation: "update", uid: "animal_1", baseVersion: 1,
      baseData: { father: null, notes: "original" }, data: { father: "Touro A", notes: "original" } },
    { base: { version: 1, data: { father: null, notes: "original" } },
      server: { uid: "animal_1", version: 2, data: { father: null, notes: "corrigida na nuvem" }, updated_at: "2026-09-08T10:00:00.000Z", deleted_at: null } }
  )`, context);

  assert.equal(result.safe, true);
  assert.equal(result.mode, "merged");
  assert.equal(result.keep.baseVersion, 2);
  assert.equal(result.keep.data.father, "Touro A");
  assert.equal(result.keep.data.notes, "corrigida na nuvem");
});

test("classificação não sobrescreve mudanças divergentes no mesmo campo", () => {
  const context = syncContext();
  const result = vm.runInContext(`RebanhoSync.classifyChange(
    { entity: "animals", operation: "update", uid: "animal_1", baseVersion: 1,
      baseData: { father: null }, data: { father: "Touro A" } },
    { base: { version: 1, data: { father: null } },
      server: { uid: "animal_1", version: 2, data: { father: "Touro B" }, updated_at: "2026-09-08T10:00:00.000Z", deleted_at: null } }
  )`, context);

  assert.equal(result.safe, false);
  assert.deepEqual([...result.fields], ["father"]);
});

test("revisão manual mantém a escolha local e incorpora os outros campos da nuvem", () => {
  const context = syncContext();
  const result = vm.runInContext(`(() => {
    const change = { entity: "animals", operation: "update", uid: "animal_1", baseVersion: 1,
      baseData: { father: null, notes: "original" }, data: { father: "Touro A", notes: "original" } };
    const classification = RebanhoSync.classifyChange(change, {
      base: { version: 1, data: { father: null, notes: "original" } },
      server: { uid: "animal_1", version: 2, data: { father: "Touro B", notes: "nuvem" }, deleted_at: null }
    });
    return RebanhoSync.resolveManualChange(change, classification, [{ field: "father", choice: "local" }]);
  })()`, context);

  assert.equal(result.keep.baseVersion, 2);
  assert.equal(result.keep.data.father, "Touro A");
  assert.equal(result.keep.data.notes, "nuvem");
});

test("revisão manual aceita um novo valor informado na interface", () => {
  const context = syncContext();
  const result = vm.runInContext(`(() => {
    const change = { entity: "animals", operation: "update", uid: "animal_1", baseVersion: 1,
      baseData: { father: null }, data: { father: "Touro A" } };
    const classification = RebanhoSync.classifyChange(change, {
      base: { version: 1, data: { father: null } },
      server: { uid: "animal_1", version: 2, data: { father: "Touro B" }, deleted_at: null }
    });
    return RebanhoSync.resolveManualChange(change, classification, [{ field: "father", choice: "custom", value: "Touro C" }]);
  })()`, context);

  assert.equal(result.keep.data.father, "Touro C");
});

test("sincronização automática tenta resolver conflitos e busca novidades periodicamente", () => {
  const sync = read("src/sync.js");
  const database = read("src/database.js");
  const auth = read("src/auth.js");
  const bootstrap = read("src/bootstrap.js");
  const config = read("src/config.js");

  assert.match(sync, /async function runAutomatic[\s\S]*result\.conflict[\s\S]*resolveConflicts\(\)/);
  assert.match(database, /RebanhoSync\.runAutomatic/);
  assert.match(auth, /RebanhoSync\.runAutomatic/);
  assert.match(bootstrap, /window\.addEventListener\("online"[\s\S]*syncWhenActive/);
  assert.match(bootstrap, /window\.addEventListener\("pageshow"[\s\S]*syncWhenActive/);
  assert.match(bootstrap, /setInterval\(syncWhenActive, REBANHO_CONFIG\.syncIntervalMs\)/);
  assert.match(config, /syncIntervalMs:\s*60000/);
});
