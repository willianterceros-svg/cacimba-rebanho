import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = path => readFileSync(resolve(root, path), "utf8");

function run(expression) {
  const context = vm.createContext({});
  vm.runInContext(read("src/import.js"), context);
  const result = vm.runInContext(expression, context);
  return result === undefined ? undefined : JSON.parse(JSON.stringify(result));
}

test("normaliza cabeçalhos com acento, caixa e espaço", () => {
  assert.equal(run('RebanhoImport.normalizeHeader("  Avô Paterno ")'), "avo paterno");
  assert.equal(run('RebanhoImport.normalizeHeader("DATA DE NASCIMENTO")'), "data de nascimento");
  assert.equal(run("RebanhoImport.normalizeHeader(null)"), "");
});

test("aceita data BR, ISO, serial Excel e Date", () => {
  assert.equal(run('RebanhoImport.parseSheetDate("15/03/2023")'), "2023-03-15");
  assert.equal(run('RebanhoImport.parseSheetDate("5/3/2023")'), "2023-03-05");
  assert.equal(run('RebanhoImport.parseSheetDate("2023-03-15")'), "2023-03-15");
  assert.equal(run("RebanhoImport.parseSheetDate(45292)"), "2024-01-01");
  assert.equal(run("RebanhoImport.parseSheetDate(new Date(2023, 2, 15))"), "2023-03-15");
  assert.equal(run('RebanhoImport.parseSheetDate("")'), null);
  assert.equal(run('RebanhoImport.parseSheetDate("32/01/2023")'), null);
  assert.equal(run('RebanhoImport.parseSheetDate("15 de março")'), null);
});

test("normaliza sexo e texto", () => {
  assert.equal(run('RebanhoImport.normalizeSex("Fêmea")'), "F");
  assert.equal(run('RebanhoImport.normalizeSex("m")'), "M");
  assert.equal(run('RebanhoImport.normalizeSex("MACHO")'), "M");
  assert.equal(run('RebanhoImport.normalizeSex("touro")'), null);
  assert.equal(run('RebanhoImport.normalizeText("  7832 ")'), "7832");
  assert.equal(run("RebanhoImport.normalizeText(102)"), "102");
});

test("parseCsvText: separa campos, respeita aspas e vírgula/quebra de linha dentro delas", () => {
  const r = run('RebanhoImport.parseCsvText("Identificação,Sexo\\n7832,Fêmea\\n\\"7833\\",\\"Compró, Ltda\\"\\n\\"Ac\\"\\"me\\"\\"\\",Macho\\r\\n")');
  assert.deepEqual(r, [
    ["Identificação", "Sexo"],
    ["7832", "Fêmea"],
    ["7833", "Compró, Ltda"],
    ['Ac"me"', "Macho"]
  ]);
});

test("parseCsvText: aceita CSV separado por ponto e vírgula", () => {
  const r = run('RebanhoImport.parseCsvText("Identificação;Sexo;Raça\\n7832;Fêmea;Nelore\\n7833;Macho;\\\"Simental, PO\\\"")');
  assert.deepEqual(r, [
    ["Identificação", "Sexo", "Raça"],
    ["7832", "Fêmea", "Nelore"],
    ["7833", "Macho", "Simental, PO"]
  ]);
});

const STOCK = `[
  ["Identificação","Sexo","Data de nascimento","Pai","Mãe","Avô paterno","Avó paterna","Avô materno","Avó materna","Raça"],
  ["7832","Fêmea","15/03/2023","REI 22","","","","","","Nelore"],
  ["7833","","","","MATRIZ 9","","","","",""],
  ["7834","Macho","data ruim","","","","","","",""],
  ["","Fêmea","","","","","","","",""],
  ["7832","Fêmea","","","","","","","",""],
  ["9001","Fêmea","","","","","","","","Girolando"]
]`;

test("estoque: separa linhas válidas das pendências", () => {
  const p = run(`RebanhoImport.buildStockPreview(${STOCK}, { existingTags: ["9001"], defaultSex: "F", defaultBreed: "Nelore", onDuplicate: "skip" })`);
  assert.deepEqual(p.ready.map(r => r.id), ["7832", "7833"]);
  assert.equal(p.ready[0].sex, "F");
  assert.equal(p.ready[0].birth, "2023-03-15");
  assert.equal(p.ready[0].father, "REI 22");
  assert.equal(p.ready[0].breed, "Nelore");
  assert.equal(p.ready[1].sex, "F");
  assert.equal(p.ready[1].breed, "Nelore");
  assert.equal(p.ready[1].birth, null);
  assert.deepEqual(p.skipped, [
    { line: 4, id: "7834", reason: "Data de nascimento inválida." },
    { line: 5, id: "", reason: "Identificação em branco." },
    { line: 6, id: "7832", reason: "Identificação repetida dentro do arquivo." },
    { line: 7, id: "9001", reason: "Identificação já cadastrada no sistema." }
  ]);
  assert.deepEqual(p.summary, { total: 6, create: 2, update: 0, skipped: 4 });
});

test("estoque: onDuplicate 'fill' transforma já-cadastrado em atualização", () => {
  const p = run(`RebanhoImport.buildStockPreview(${STOCK}, { existingTags: ["9001"], defaultSex: "M", defaultBreed: "Nelore", onDuplicate: "fill" })`);
  const upd = p.ready.filter(r => r.action === "update");
  assert.deepEqual(upd.map(r => r.id), ["9001"]);
  assert.equal(p.summary.update, 1);
  assert.equal(p.summary.create, 2);
});

test("estoque: coluna Sexo/Raça da linha vence o padrão; comparação de brinco ignora caixa e espaço", () => {
  const p = run('RebanhoImport.buildStockPreview([["Identificação","Sexo","Raça"],[" 7832 ","Macho","Angus"]], { existingTags: ["7832"], defaultSex: "F", defaultBreed: "Nelore", onDuplicate: "skip" })');
  assert.deepEqual(p.skipped.map(r => r.reason), ["Identificação já cadastrada no sistema."]);
});

test("estoque: planilha sem a coluna de identificação devolve erro", () => {
  const p = run('RebanhoImport.buildStockPreview([["Sexo","Raça"],["Fêmea","Nelore"]], { existingTags: [], defaultSex: "F", defaultBreed: "Nelore", onDuplicate: "skip" })');
  assert.equal(p.error, "A planilha precisa ter a coluna: Identificação.");
  assert.deepEqual(p.ready, []);
});

test("estoque: sexo preenchido com valor inválido vira pendência", () => {
  const p = run('RebanhoImport.buildStockPreview([["Identificação","Sexo"],["7832","Touro"]], { existingTags: [], defaultSex: "F", defaultBreed: "Nelore" })');
  assert.deepEqual(p.ready, []);
  assert.deepEqual(p.skipped, [{ line: 2, id: "7832", reason: "Sexo inválido. Use Fêmea, Macho, F ou M." }]);
});

const CTX = `{ actor: { name: "Gustavo", login: "gustavo", uid: "u1" }, createdAt: "2026-09-10T12:00:00.000Z", sourceName: "rebanho-marco.xlsx", uidSeed: 1000, tagToUid: { "9001": "u-existente" } }`;

test("estoque: cria animal no formato do cadastro manual", () => {
  const r = run(`RebanhoImport.buildStockRecords([
    { line: 2, id: "7832", sex: "F", birth: "2023-03-15", father: "REI 22", mother: "", pgf: "", pgm: "", mgf: "", mgm: "", breed: "Nelore", action: "create" }
  ], ${CTX})`);
  assert.equal(r.created.length, 1);
  const a = r.created[0];
  assert.equal(a.id, "7832");
  assert.equal(a.sex, "F");
  assert.equal(a.status, "ATIVO");
  assert.equal(a.birth, "2023-03-15");
  assert.equal(a.father, "REI 22");
  assert.equal(a.mother, "");
  assert.equal(a.breed, "Nelore");
  assert.equal(a.origin, "Importação de planilha");
  assert.equal(a.importSource, "rebanho-marco.xlsx");
  assert.equal(a.createdBy, "Gustavo");
  assert.equal(a.createdByLogin, "gustavo");
  assert.equal(a.createdByUid, "u1");
  assert.equal(a.createdAt, "2026-09-10T12:00:00.000Z");
  assert.equal(a.uid, "imp_1000_2");
});

test("estoque: linha update aponta o uid existente e traz patch de candidatos", () => {
  const r = run(`RebanhoImport.buildStockRecords([
    { line: 3, id: "9001", sex: "F", birth: "2020-01-01", father: "PAI X", mother: "", pgf: "", pgm: "", mgf: "", mgm: "", breed: "Girolando", action: "update" }
  ], ${CTX})`);
  assert.deepEqual(r.created, []);
  assert.equal(r.updates[0].uid, "u-existente");
  assert.equal(r.updates[0].patch.sex, "F");
  assert.equal(r.updates[0].patch.father, "PAI X");
  assert.equal(r.updates[0].patch.breed, "Girolando");
  assert.equal(r.updates[0].patch.birth, "2020-01-01");
});

test("estoque: atualização localiza brinco ignorando caixa e espaços", () => {
  const r = run(`RebanhoImport.buildStockRecords([
    { line: 2, id: " ab-12 ", sex: "M", birth: null, father: "", mother: "", pgf: "", pgm: "", mgf: "", mgm: "", breed: "Nelore", action: "update" }
  ], { actor: {}, createdAt: "", sourceName: "", uidSeed: 1, tagToUid: { "ab-12": "u-existente" } })`);
  assert.equal(r.updates[0].uid, "u-existente");
});

test("estoque: uid único por linha", () => {
  const r = run(`RebanhoImport.buildStockRecords([
    { line: 2, id: "A", sex: "F", birth: null, father:"",mother:"",pgf:"",pgm:"",mgf:"",mgm:"", breed:"Nelore", action: "create" },
    { line: 3, id: "B", sex: "F", birth: null, father:"",mother:"",pgf:"",pgm:"",mgf:"",mgm:"", breed:"Nelore", action: "create" }
  ], ${CTX})`);
  assert.deepEqual(r.created.map(a => a.uid), ["imp_1000_2", "imp_1000_3"]);
});

const HERD_INDEX = `{ "7832": { uid: "a1", status: "ATIVO" }, "7833": { uid: "a2", status: "ATIVO" }, "7900": { uid: "a9", status: "VENDIDO" } }`;
const SALE = `[
  ["Data da venda","Comprador","Identificação do animal"],
  ["10/09/2026","Frigorífico Sul","7832"],
  ["","","7833"],
  ["10/09/2026","Frigorífico Sul","7900"],
  ["10/09/2026","Frigorífico Sul","0000"],
  ["10/09/2026","Frigorífico Sul","7832"],
  ["data ruim","Frigorífico Sul","7833"]
]`;

test("venda: separa prontas de pendências, aplicando padrão da tela", () => {
  const p = run(`RebanhoImport.buildSalePreview(${SALE}, { herdIndex: ${HERD_INDEX}, defaultDate: "2026-09-10", defaultBuyer: "Frigorífico Sul" })`);
  assert.deepEqual(p.ready.map(r => r.id), ["7832", "7833"]);
  assert.equal(p.ready[0].uid, "a1");
  assert.equal(p.ready[1].date, "2026-09-10");
  assert.equal(p.ready[1].buyer, "Frigorífico Sul");
  assert.deepEqual(p.skipped, [
    { line: 4, id: "7900", reason: "Animal já consta como vendido." },
    { line: 5, id: "0000", reason: "Animal não encontrado no rebanho." },
    { line: 6, id: "7832", reason: "Identificação repetida dentro do arquivo." },
    { line: 7, id: "7833", reason: "Data da venda inválida." }
  ]);
  assert.deepEqual(p.summary, { total: 6, ready: 2, skipped: 4 });
});

test("venda: sem padrão na tela, linha sem data/comprador vira pendência", () => {
  const p = run(`RebanhoImport.buildSalePreview([["Data da venda","Comprador","Identificação do animal"],["","","7832"]], { herdIndex: ${HERD_INDEX}, defaultDate: "", defaultBuyer: "" })`);
  assert.deepEqual(p.skipped.map(r => r.reason), ["Data da venda não informada."]);
});

test("venda: planilha sem a coluna de identificação devolve erro", () => {
  const p = run('RebanhoImport.buildSalePreview([["Data da venda","Comprador"],["10/09/2026","X"]], { herdIndex: {}, defaultDate: "", defaultBuyer: "" })');
  assert.equal(p.error, "A planilha precisa ter a coluna: Identificação do animal.");
});

test("venda: monta atualização de status e evento de venda", () => {
  const r = run(`RebanhoImport.buildSaleRecords([
    { line: 2, id: "7832", uid: "a1", date: "2026-09-10", buyer: "Frigorífico Sul" }
  ], { actor: { name: "Gustavo", login: "gustavo", uid: "u1" }, source: "vendas-setembro.xlsx" })`);
  assert.deepEqual(r.updates, [{ uid: "a1", status: "VENDIDO" }]);
  assert.equal(r.events.length, 1);
  const e = r.events[0];
  assert.equal(e.type, "sale");
  assert.equal(e.animalUid, "a1");
  assert.equal(e.id, "7832");
  assert.equal(e.date, "2026-09-10");
  assert.equal(e.buyer, "Frigorífico Sul");
  assert.equal(e.user, "Gustavo");
  assert.equal(e.userLogin, "gustavo");
  assert.equal(e.userUid, "u1");
  assert.equal(e.source, "vendas-setembro.xlsx");
});
