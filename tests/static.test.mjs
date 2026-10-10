import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = path => readFileSync(resolve(root, path), "utf8");

test("não publica dados iniciais nem credenciais privilegiadas", () => {
  const sources = ["index.html", "src/config.js", "src/state.js", "src/ui.js"].map(read).join("\n");
  const config = read("src/config.js");
  assert.doesNotMatch(sources, /initialRealHerd/);
  assert.doesNotMatch(sources, /sb_secret_/i);
  assert.match(config, /supabaseUrl:\s*"https:\/\/[^\"]+\.supabase\.co"/);
  assert.match(config, /supabasePublishableKey:\s*"[^\"]+"/);
  const jwtTokens = [...config.matchAll(/eyJ[a-zA-Z0-9_-]+\.([a-zA-Z0-9_-]+)\.[a-zA-Z0-9_-]+/g)];
  for (const token of jwtTokens) {
    const payload = JSON.parse(Buffer.from(token[1], "base64url").toString("utf8"));
    assert.equal(payload.role, "anon", "O frontend aceita somente JWT com papel anon");
  }
});

test("aplicação permanece escondida antes do login", () => {
  const html = read("index.html");
  assert.match(html, /id="appShell" class="app hidden"/);
  assert.match(read("src/state.js"), /let herd = \[\]/);
  assert.doesNotMatch(read("src/bootstrap.js"), /renderStock\(\).*else/);
});

test("versão aparece no login, na troca de senha e no cabeçalho fixo do aplicativo", () => {
  const html = read("index.html");
  const config = read("src/config.js");
  const serviceWorker = read("sw.js");
  const css = read("assets/css/app.css");
  const version = config.match(/appVersion:\s*"([0-9.]+)"/)?.[1];
  assert.ok(version);
  const displayed = [...html.matchAll(/class="(?:login-version|app-version)">Versão ([0-9.]+)<\/div>/g)].map(match => match[1]);
  assert.deepEqual(displayed, [version, version, version]);
  const assets = [...html.matchAll(/(?:src|href)="\.\/[^"?#]+\?v=([0-9.]+)"/g)].map(match => match[1]);
  assert.ok(assets.length > 0);
  assert.ok(assets.every(item => item === version));
  assert.ok(serviceWorker.includes("const CACHE_NAME = `${CACHE_PREFIX}" + version + "`;"));
  assert.match(css, /\.topbar\{position:sticky/);
});

test("mantém as chaves da autenticação original", () => {
  const authentication = ["src/state.js", "src/auth.js"].map(read).join("\n");
  for (const key of ["cacimba2_current_user", "cacimba2_session_token", "cacimba2_offline_login"]) assert.match(authentication, new RegExp(key));
  assert.doesNotMatch(authentication, /cacimba3_/);
});

test("todos os arquivos estáticos referenciados existem", () => {
  const html = read("index.html");
  const paths = [...html.matchAll(/(?:src|href)="\.\/([^"?#]+)[^\"]*"/g)].map(match => match[1]);
  for (const path of paths) assert.ok(existsSync(resolve(root, path)), `Arquivo ausente: ${path}`);
  const serviceWorker = read("sw.js");
  for (const path of [...serviceWorker.matchAll(/"\.\/([^"?#]+)"/g)].map(match => match[1]).filter(path => path && path !== "")) assert.ok(existsSync(resolve(root, path)), `Cache aponta para arquivo ausente: ${path}`);
});

test("todos os manipuladores declarados no HTML existem no JavaScript", () => {
  const html = read("index.html");
  const sources = ["src/state.js", "src/auth.js", "src/genealogy.js", "src/ui.js", "src/import.js", "src/backup.js", "src/bootstrap.js", "src/sync.js"].map(read).join("\n");
  const handlers = [...new Set([...html.matchAll(/on(?:click|change|input)="([A-Za-z_$][\w$]*)\s*\(/g)].map(match => match[1]))];
  const missing = handlers.filter(name => !new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(|(?:const|let|var)\\s+${name}\\s*=`).test(sources));
  assert.deepEqual(missing, []);
});

test("RPCs novas possuem pasta SQL com o mesmo nome", () => {
  const sources = ["src/sync.js", "src/backup.js"].map(read).join("\n");
  const names = [...new Set([...sources.matchAll(/rpc\("(rebanho_(?:pull_changes|push_changes|export_backup|import_backup|conflict_context))"/g)].map(match => match[1]))];
  assert.deepEqual(names.sort(), ["rebanho_conflict_context", "rebanho_export_backup", "rebanho_import_backup", "rebanho_pull_changes", "rebanho_push_changes"]);
  for (const name of names) assert.ok(existsSync(resolve(root, `supabase/database-functions/${name}/function.sql`)), `SQL ausente: ${name}`);
});

test("esquema incremental não remove as três tabelas antigas", () => {
  const schema = read("supabase/00-schema.sql");
  assert.doesNotMatch(schema, /drop\s+table/i);
  assert.match(schema, /Não remove nem altera rebanho_users, rebanho_sessions ou rebanho_state/);
});

test("atualização preserva o banco local do aparelho sem exigir limpeza de dados", () => {
  const database = read("src/database.js");
  assert.match(database, /const DB_NAME = "cacimba_rebanho_ajustada";/);
  assert.match(database, /const DB_VERSION = 1;/);
  for (const file of ["src/database.js", "src/sync.js", "src/auth.js", "src/bootstrap.js", "src/backup.js", "sw.js"]) {
    assert.doesNotMatch(read(file), /deleteDatabase|localStorage\.clear|sessionStorage\.clear|\.storage\.clear/, file);
  }
  const serviceWorker = read("sw.js");
  assert.match(serviceWorker, /keys\.filter\(key => key\.startsWith\(CACHE_PREFIX\) && key !== CACHE_NAME\)/);
});

test("SQL do repositório segue a produção: campo envia genealogia, mas não exclui nem altera reprodutores", () => {
  const sql = read("supabase/database-functions/rebanho_push_changes/function.sql");
  assert.match(sql, /if v_entity in \('reproducers','historical_dams'\) or v_operation = 'delete' then\s+return jsonb_build_object\('ok', false, 'error', 'ROLE_DENIED'\);/);
  assert.doesNotMatch(sql, /'historical_dams','pedigree'\) or v_operation = 'delete'/);
});
