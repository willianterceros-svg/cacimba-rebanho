const RebanhoApi = (() => {
  function configured() {
    return Boolean(REBANHO_CONFIG.supabaseUrl && REBANHO_CONFIG.supabasePublishableKey);
  }

  async function rpc(name, body = {}) {
    if (!configured()) throw new Error("Supabase não configurado em src/config.js");
    const response = await fetch(`${REBANHO_CONFIG.supabaseUrl.replace(/\/$/, "")}/rest/v1/rpc/${name}`, {
      method: "POST",
      headers: {
        apikey: REBANHO_CONFIG.supabasePublishableKey,
        Authorization: `Bearer ${REBANHO_CONFIG.supabasePublishableKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });
    const raw = await response.text();
    let payload = null;
    try { payload = raw ? JSON.parse(raw) : null; } catch { payload = raw; }
    if (!response.ok) {
      const message = payload?.message || payload?.error || `Falha de comunicação (${response.status})`;
      throw new Error(message);
    }
    return payload;
  }

  return { configured, rpc };
})();

// Compatibilidade com as funções da interface original.
const rpc = RebanhoApi.rpc;

