function roleLabel(role) { return role === "OWNER" ? "Proprietário" : role === "ADMIN" ? "Administrador" : "Funcionário de campo"; }
function roleClass(role) { return role === "OWNER" ? "role-owner" : role === "ADMIN" ? "role-admin" : "role-field"; }

async function sha256Text(value) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes)).map(byte => byte.toString(16).padStart(2, "0")).join("");
}
async function cacheOfflineCredential(user, password) {
  try {
    localStorage.setItem("cacimba2_offline_login", JSON.stringify({
      user: { uid: user.uid, name: user.name, login: user.login, role: user.role },
      hash: await sha256Text(`${user.login.toLowerCase()}|${password}`)
    }));
  } catch {}
}
async function tryOfflineLogin(login, password) {
  try {
    const cached = JSON.parse(localStorage.getItem("cacimba2_offline_login") || "null");
    if (!cached || cached.user.login.toLowerCase() !== login) return null;
    return await sha256Text(`${login}|${password}`) === cached.hash ? cached.user : null;
  } catch { return null; }
}
async function doLogin() {
  const login = loginUser.value.trim().toLowerCase(), password = loginPassword.value;
  loginError.style.display = "none";
  if (!login || !password) { loginError.style.display = "block"; loginError.textContent = "Informe usuário e senha."; return; }
  if (navigator.onLine && RebanhoApi.configured()) {
    try {
      const result = await rpc("rebanho_login", { p_login: login, p_password: password });
      if (!result.ok) { loginError.style.display = "block"; loginError.textContent = "Usuário ou senha incorretos."; return; }
      sessionToken = result.token;
      sessionStorage.setItem("cacimba2_session_token", sessionToken);
      pendingFirstLoginUser = result.user;
      if (result.user.firstLogin) {
        await cacheOfflineCredential(result.user, password);
        loginShell.classList.add("hidden"); firstPasswordShell.classList.remove("hidden"); return;
      }
      await cacheOfflineCredential(result.user, password);
      await startSession(result.user, true);
      return;
    } catch (error) { console.error(error); }
  }
  const offlineUser = await tryOfflineLogin(login, password);
  if (offlineUser) { sessionToken = ""; await startSession(offlineUser, false); return; }
  loginError.style.display = "block";
  loginError.textContent = navigator.onLine ? "Não foi possível validar o acesso." : "O primeiro acesso neste aparelho precisa de internet.";
}
async function completeFirstPassword() {
  const first = firstNewPassword.value, second = firstNewPassword2.value;
  if (first.length < 4) { firstPasswordError.style.display = "block"; firstPasswordError.textContent = "A senha precisa ter pelo menos 4 caracteres."; return; }
  if (first !== second) { firstPasswordError.style.display = "block"; firstPasswordError.textContent = "As senhas não conferem."; return; }
  if (!sessionToken || !navigator.onLine) { firstPasswordError.style.display = "block"; firstPasswordError.textContent = "A troca da senha inicial precisa de internet."; return; }
  try {
    const result = await rpc("rebanho_change_password", { p_token: sessionToken, p_password: first });
    if (!result.ok) throw new Error(result.error || "Erro");
    pendingFirstLoginUser.firstLogin = false;
    await cacheOfflineCredential(pendingFirstLoginUser, first);
    firstPasswordShell.classList.add("hidden"); firstPasswordError.style.display = "none";
    await startSession(pendingFirstLoginUser, true);
  } catch { firstPasswordError.style.display = "block"; firstPasswordError.textContent = "Não foi possível trocar a senha."; }
}
async function startSession(user, loadCloud = true) {
  currentUser = { uid: user.uid, name: user.name, login: user.login, role: user.role };
  sessionStorage.setItem("cacimba2_current_user", JSON.stringify(currentUser));
  loginShell.classList.add("hidden"); firstPasswordShell.classList.add("hidden"); appShell.classList.remove("hidden");
  applySnapshot(await RebanhoData.loadAfterLogin());
  migrateReproducers(); rebuildPedigreeLibrary(); migrateLegacyGenealogyLinks(); bindPedigreeAutocomplete();
  if (loadCloud && sessionToken && navigator.onLine) await RebanhoSync.run({ silent: true });
  applyPermissions(); renderAccount(); refreshAllViews(); showScreen("stock", false);
  if (currentUser.role === "OWNER") await refreshUsers();
}
async function resumeSession() {
  if (!currentUser) return false;
  appShell.classList.remove("hidden"); loginShell.classList.add("hidden");
  await startSession(currentUser, Boolean(sessionToken));
  return true;
}
function logout() {
  sessionStorage.removeItem("cacimba2_current_user"); sessionStorage.removeItem("cacimba2_session_token");
  currentUser = null; sessionToken = ""; clearLoadedData();
  loginPassword.value = ""; appShell.classList.add("hidden"); loginShell.classList.remove("hidden");
}
function ensureAuthorized() { return currentUser ? resumeSession() : Promise.resolve(false); }
function applyPermissions() {
  const role = currentUser?.role, owner = role === "OWNER", admin = role === "ADMIN", field = role === "FIELD";
  const set = (id, show) => { const element = document.getElementById(id); if (element) element.classList.toggle("permission-hidden", !show); };
  set("navRepro", !field); set("moreReproRow", !field); set("moreImportRow", owner || admin); set("moreUsersRow", owner);
  set("stockAdminActions", owner || admin); set("accountUsersBtn", owner); set("searchEditGenealogyBtn", owner || admin); set("importBackupBtn", owner);
  if (field && ["repro", "addRepro", "reproDetail", "editRepro", "users", "addUser", "importStock", "addAnimal", "editAnimal"].includes(document.querySelector(".screen.active")?.id)) showScreen("stock", false);
}
function renderAccount() {
  if (!currentUser) return;
  accountName.textContent = currentUser.name; accountLogin.textContent = `Usuário: ${currentUser.login}`;
  accountRole.replaceChildren(); const badge = document.createElement("span"); badge.className = `user-chip ${roleClass(currentUser.role)}`; badge.textContent = roleLabel(currentUser.role); accountRole.append(badge);
  renderSyncInfo();
}
async function refreshUsers() {
  if (!currentUser || currentUser.role !== "OWNER" || !sessionToken || !navigator.onLine) { renderUsers(); return; }
  try { const result = await rpc("rebanho_list_users", { p_token: sessionToken }); if (result.ok) users = result.users || []; } catch (error) { console.error(error); }
  renderUsers();
}
function renderUsers() {
  usersList.replaceChildren();
  if (!currentUser || currentUser.role !== "OWNER") { const empty = document.createElement("div"); empty.className = "center muted"; empty.textContent = "Acesso restrito ao Proprietário."; usersList.append(empty); return; }
  if (!users.length) { const empty = document.createElement("div"); empty.className = "center muted"; empty.textContent = "Conecte-se à internet para carregar os usuários."; usersList.append(empty); return; }
  for (const user of users) {
    const row = document.createElement("div"); row.className = "row"; row.style.alignItems = "flex-start";
    const content = document.createElement("div"), name = document.createElement("b"), login = document.createElement("div"), badges = document.createElement("div");
    name.textContent = user.name; login.className = "muted"; login.textContent = `@${user.login}`; badges.style.marginTop = "6px";
    const roleBadge = document.createElement("span"); roleBadge.className = `badge ${roleClass(user.role)}`; roleBadge.textContent = roleLabel(user.role); badges.append(roleBadge);
    if (user.firstLogin) { const badge = document.createElement("span"); badge.className = "badge warn"; badge.textContent = "Troca de senha pendente"; badges.append(" ", badge); }
    if (!user.active) { const badge = document.createElement("span"); badge.className = "badge warn"; badge.textContent = "Inativo"; badges.append(" ", badge); }
    content.append(name, login, badges);
    const actions = document.createElement("div"); actions.className = "user-actions";
    if (user.role !== "OWNER") {
      [["Redefinir senha", () => resetUserPassword(user.uid)], [user.active ? "Desativar" : "Ativar", () => toggleUser(user.uid)], ["Excluir", () => deleteUser(user.uid)]].forEach(([text, action], index) => { const button = document.createElement("button"); button.className = `mini${index === 2 ? " dangerText" : ""}`; button.textContent = text; button.onclick = action; actions.append(button); });
    } else { const protectedText = document.createElement("span"); protectedText.className = "muted"; protectedText.textContent = "Perfil principal indeletável"; actions.append(protectedText); }
    content.append(actions); row.append(content); usersList.append(row);
  }
}
async function createUser() {
  if (currentUser?.role !== "OWNER") return alert("Apenas o Proprietário pode cadastrar usuários.");
  if (!navigator.onLine) return alert("É preciso internet para cadastrar um novo usuário.");
  const name = userName.value.trim(), login = userLogin.value.trim().toLowerCase(), password = userInitialPassword.value;
  if (!name || !login) return alert("Informe nome e usuário."); if (password.length < 4) return alert("A senha inicial deve ter pelo menos 4 caracteres.");
  try { const result = await rpc("rebanho_create_user", { p_token: sessionToken, p_name: name, p_login: login, p_password: password, p_role: userRole.value }); if (!result.ok) { if (result.error === "LOGIN_EXISTS") return alert("Esse usuário já existe."); throw new Error(result.error); } log(`Usuário ${login} cadastrado com perfil ${roleLabel(userRole.value)}.`); await refreshUsers(); showScreen("users"); } catch { alert("Não foi possível cadastrar o usuário."); }
}
async function resetUserPassword(uid) { if (currentUser?.role !== "OWNER" || !navigator.onLine) return alert("É preciso internet para redefinir a senha."); const user = users.find(item => item.uid === uid); if (!user) return; const password = prompt(`Nova senha inicial para ${user.name}:`, "1234"); if (password === null) return; if (password.length < 4) return alert("Use pelo menos 4 caracteres."); try { const result = await rpc("rebanho_reset_user_password", { p_token: sessionToken, p_user_id: uid, p_password: password }); if (!result.ok) throw new Error(result.error); log(`Senha do usuário ${user.login} redefinida.`); await refreshUsers(); alert("Senha redefinida. No próximo acesso, ele deverá trocá-la."); } catch { alert("Não foi possível redefinir a senha."); } }
async function toggleUser(uid) { if (currentUser?.role !== "OWNER" || !navigator.onLine) return alert("É preciso internet para alterar usuários."); const user = users.find(item => item.uid === uid); if (!user || user.role === "OWNER") return; try { const result = await rpc("rebanho_toggle_user", { p_token: sessionToken, p_user_id: uid }); if (!result.ok) throw new Error(result.error); log(`Usuário ${user.login} ${user.active ? "desativado" : "ativado"}.`); await refreshUsers(); } catch { alert("Não foi possível alterar o usuário."); } }
async function deleteUser(uid) { if (currentUser?.role !== "OWNER" || !navigator.onLine) return alert("É preciso internet para excluir usuários."); const user = users.find(item => item.uid === uid); if (!user || user.role === "OWNER" || !confirm(`Excluir o usuário ${user.login}?`)) return; try { const result = await rpc("rebanho_delete_user", { p_token: sessionToken, p_user_id: uid }); if (!result.ok) throw new Error(result.error); log(`Usuário ${user.login} excluído.`); await refreshUsers(); } catch { alert("Não foi possível excluir o usuário."); } }
