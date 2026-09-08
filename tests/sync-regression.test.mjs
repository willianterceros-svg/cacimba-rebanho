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
