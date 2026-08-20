const { getStore, connectLambda } = require("@netlify/blobs");
const FALLBACK = require("../../shop-config.json");

const STORE = "suttonly-config";
const KEY = "shop-config";

// Single source of truth for the order functions.
// Admin edits live in Blobs; the repo file is the fallback for first run.
async function loadConfig(event) {
  try {
    // Lambda-style functions must connect before Blobs is usable
    if (event) connectLambda(event);
    const store = getStore(STORE);
    const saved = await store.get(KEY, { type: "json" });
    if (saved && saved.items) return saved;
  } catch (err) {
    console.error("Config load from Blobs failed, using file:", err && err.message);
  }
  return FALLBACK;
}

module.exports = { loadConfig };
