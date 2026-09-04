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
  const sources = ["src/state.js", "src/auth.js", "src/genealogy.js", "src/ui.js", "src/backup.js", "src/bootstrap.js", "src/sync.js"].map(read).join("\n");
  const handlers = [...new Set([...html.matchAll(/on(?:click|change|input)="([A-Za-z_$][\w$]*)\s*\(/g)].map(match => match[1]))];
  const missing = handlers.filter(name => !new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(|(?:const|let|var)\\s+${name}\\s*=`).test(sources));
  assert.deepEqual(missing, []);
});

test("RPCs novas possuem pasta SQL com o mesmo nome", () => {
  const sources = ["src/sync.js", "src/backup.js"].map(read).join("\n");
  const names = [...new Set([...sources.matchAll(/rpc\("(rebanho_(?:pull_changes|push_changes|export_backup|import_backup))"/g)].map(match => match[1]))];
  assert.deepEqual(names.sort(), ["rebanho_export_backup", "rebanho_import_backup", "rebanho_pull_changes", "rebanho_push_changes"]);
  for (const name of names) assert.ok(existsSync(resolve(root, `supabase/database-functions/${name}/function.sql`)), `SQL ausente: ${name}`);
});

test("esquema incremental não remove as três tabelas antigas", () => {
  const schema = read("supabase/00-schema.sql");
  assert.doesNotMatch(schema, /drop\s+table/i);
  assert.match(schema, /Não remove nem altera rebanho_users, rebanho_sessions ou rebanho_state/);
});
