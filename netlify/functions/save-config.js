const { getStore } = require("@netlify/blobs");

const STORE = "suttonly-config";
const KEY = "shop-config";

exports.handler = async function (event) {
  if (event.httpMethod !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return json(400, { error: "Invalid request" });
  }

  // --- Auth ---
  const expected = process.env.ADMIN_PASSCODE;
  if (!expected) {
    return json(500, { error: "ADMIN_PASSCODE is not set in Netlify environment variables." });
  }
  if (!body.passcode || body.passcode !== expected) {
    return json(401, { error: "Wrong passcode." });
  }

  const config = body.config;
  if (!config || typeof config !== "object") {
    return json(400, { error: "Missing config" });
  }

  // --- Validation: refuse to save anything that would break the storefront ---
  const errors = [];
  const S = config.settings;

  if (!S || typeof S !== "object") {
    errors.push("settings block is missing");
  } else {
    if (!Number.isInteger(S.minLeadDays) || S.minLeadDays < 0 || S.minLeadDays > 60) {
      errors.push("minLeadDays must be a whole number between 0 and 60");
    }
    if (!Array.isArray(S.allowedPickupWeekdays) || S.allowedPickupWeekdays.some(d => !Number.isInteger(d) || d < 0 || d > 6)) {
      errors.push("allowedPickupWeekdays must be day numbers 0-6");
    }
    if (typeof S.deliveryFee !== "number" || S.deliveryFee < 0) {
      errors.push("deliveryFee must be 0 or more");
    }
  }

  if (!Array.isArray(config.items) || config.items.length === 0) {
    errors.push("at least one item is required");
  } else {
    const seen = new Set();
    config.items.forEach((it, i) => {
      const label = it.name || `item ${i + 1}`;
      if (!it.id || /[\s"']/.test(it.id)) errors.push(`${label}: id must have no spaces or quotes`);
      if (seen.has(it.id)) errors.push(`${label}: duplicate id "${it.id}"`);
      seen.add(it.id);
      if (!it.name) errors.push(`item ${i + 1}: name is required`);
      if (it.type !== "custom") {
        if (typeof it.price !== "number" || it.price <= 0) errors.push(`${label}: price must be greater than 0`);
      }
      if (it.flavors) {
        if (!Array.isArray(it.flavors)) {
          errors.push(`${label}: flavors must be a list`);
        } else {
          const fseen = new Set();
          it.flavors.forEach(f => {
            if (!f.id || /[\s"']/.test(f.id)) errors.push(`${label}: flavor id "${f.id}" has spaces or quotes`);
            if (fseen.has(f.id)) errors.push(`${label}: duplicate flavor id "${f.id}"`);
            fseen.add(f.id);
            if (!f.name) errors.push(`${label}: a flavor is missing a name`);
            if (f.price != null && (typeof f.price !== "number" || f.price <= 0)) {
              errors.push(`${label} / ${f.name}: price must be greater than 0`);
            }
          });
        }
      }
    });
  }

  if (config.events) {
    if (!Array.isArray(config.events)) {
      errors.push("events must be a list");
    } else {
      const eseen = new Set();
      config.events.forEach((e, i) => {
        const label = e.name || `event ${i + 1}`;
        if (!e.id || /[\s"']/.test(e.id)) errors.push(`${label}: id must have no spaces or quotes`);
        if (eseen.has(e.id)) errors.push(`${label}: duplicate id`);
        eseen.add(e.id);
        if (!e.name) errors.push(`event ${i + 1}: name is required`);
        if (!e.date || !/^\d{4}-\d{2}-\d{2}$/.test(e.date)) errors.push(`${label}: needs a valid date`);
        if (!e.location) errors.push(`${label}: location is required`);
      });
    }
  }

  if (config.blockedDates && !Array.isArray(config.blockedDates)) {
    errors.push("blockedDates must be a list");
  }

  if (errors.length) {
    return json(400, { error: "Couldn't save — fix these first:", details: errors });
  }

  // --- Save ---
  try {
    const store = getStore(STORE);
    await store.setJSON(KEY, config);
    return json(200, { success: true, savedAt: new Date().toISOString() });
  } catch (err) {
    console.error("Blobs write failed:", err && err.message);
    return json(500, { error: "Save failed: " + ((err && err.message) || "unknown error") });
  }
};

function json(statusCode, obj) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(obj)
  };
}
