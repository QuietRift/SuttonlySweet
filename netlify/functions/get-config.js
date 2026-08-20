const { getStore, connectLambda } = require("@netlify/blobs");
const FALLBACK = require("../../shop-config.json");

const STORE = "suttonly-config";
const KEY = "shop-config";

exports.handler = async function (event) {
  try {
    // Lambda-style functions must connect before Blobs is usable
    connectLambda(event);
    const store = getStore(STORE);
    const saved = await store.get(KEY, { type: "json" });
    if (saved && saved.items) {
      return json(200, saved);
    }
  } catch (err) {
    console.error("Blobs read failed, using file fallback:", err && err.message);
  }
  // First run (nothing saved yet) or Blobs unavailable — serve the repo file
  return json(200, FALLBACK);
};

function json(statusCode, obj) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store"
    },
    body: JSON.stringify(obj)
  };
}
