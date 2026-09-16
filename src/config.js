const REBANHO_ENVS = {
  prod: {
    supabaseUrl: "https://kwogzwdidzenfmdxmiwv.supabase.co",
    supabasePublishableKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt3b2d6d2RpZHplbmZtZHhtaXd2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY4MDM4OTMsImV4cCI6MjEwMjM3OTg5M30.EXX4HMhPQKcrGh9X9vq9Z8Vr8bqz4shVCKwPk59DO_Y"
  },
  dev: {
    supabaseUrl: "https://xfdirruvwqvyuchnelbf.supabase.co",
    supabasePublishableKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhmZGlycnV2d3F2eXVjaG5lbGJmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgzOTQ2MTcsImV4cCI6MjEwMzk3MDYxN30.ZRXEPvmw62Hi8y3_A8tlxHM8c2vUexjNrkPeYcbX87Y"
  }
};

const REBANHO_ENV_OVERRIDE = "";

const REBANHO_ENV_FORCED = ["dev", "prod"].includes(REBANHO_ENV_OVERRIDE.trim().toLowerCase())
  ? REBANHO_ENV_OVERRIDE.trim().toLowerCase() : null;

const REBANHO_ENV = REBANHO_ENV_FORCED ||
  (/^(localhost|127\.0\.0\.1|\[::1\]|.*\.local)$/i.test(location.hostname) ? "dev" : "prod");

const REBANHO_CONFIG = Object.freeze({
  ...REBANHO_ENVS[REBANHO_ENV],
  env: REBANHO_ENV,
  syncPageSize: 750,
  syncIntervalMs: 60000,
  appVersion: "3.2.16"
});

console.log(`[Cacimba Rebanho] ambiente: ${REBANHO_CONFIG.env.toUpperCase()} (${REBANHO_ENV_FORCED ? "forçado em REBANHO_ENV_OVERRIDE" : "detectado por hostname"}) — ${REBANHO_CONFIG.supabaseUrl} — versão ${REBANHO_CONFIG.appVersion}`);
