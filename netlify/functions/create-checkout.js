const { SquareClient, SquareEnvironment } = require("square");
const CONFIG = require("../../shop-config.json");

exports.handler = async function (event) {
  if (event.httpMethod !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return json(400, { error: "Invalid request body" });
  }

  const { cart, customer, fulfillment } = body;
  // cart: [{ id, qty }]
  // customer: { firstName, lastName, email, phone }
  // fulfillment: { type: "pickup"|"event"|"delivery", date?, eventId?, address? }

  if (!Array.isArray(cart) || cart.length === 0) {
    return json(400, { error: "Cart is empty" });
  }
  if (!customer || !customer.firstName || !customer.lastName || !customer.email || !customer.phone) {
    return json(400, { error: "Missing customer details" });
  }
  if (!fulfillment || !fulfillment.type) {
    return json(400, { error: "Missing fulfillment details" });
  }

  const S = CONFIG.settings;

  // ---- Resolve fulfillment date + validate rules (server is source of truth) ----
  let fulfillDate;      // "YYYY-MM-DD"
  let fulfillLabel;     // human-readable, goes on the Square order
  let chosenEvent = null;

  if (fulfillment.type === "event") {
    chosenEvent = (CONFIG.events || []).find(e => e.id === fulfillment.eventId);
    if (!chosenEvent) return json(400, { error: "Unknown event" });
    fulfillDate = chosenEvent.date;
    fulfillLabel = `EVENT PICKUP: ${chosenEvent.name} — ${chosenEvent.location} (${chosenEvent.date}${chosenEvent.hours ? ", " + chosenEvent.hours : ""})`;
  } else {
    fulfillDate = fulfillment.date;
    if (!fulfillDate || !/^\d{4}-\d{2}-\d{2}$/.test(fulfillDate)) {
      return json(400, { error: "Missing or invalid date" });
    }

    // Lead time: date must be at least minLeadDays out (Detroit time)
    const now = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Detroit" }));
    const minDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + S.minLeadDays);
    const chosen = new Date(fulfillDate + "T00:00:00");
    if (chosen < minDate) {
      return json(400, { error: `Orders need at least ${S.minLeadDays} days' notice.` });
    }

    // Allowed weekdays (applies to individual pickup AND delivery, not events)
    if (Array.isArray(S.allowedPickupWeekdays) && S.allowedPickupWeekdays.length > 0) {
      if (!S.allowedPickupWeekdays.includes(chosen.getDay())) {
        return json(400, { error: "That day isn't available for pickup or delivery." });
      }
    }

    if (fulfillment.type === "delivery") {
      if (!S.deliveryEnabled) return json(400, { error: "Delivery is not currently offered." });
      const a = fulfillment.address || {};
      if (!a.street || !a.city || !a.zip) {
        return json(400, { error: "Missing delivery address" });
      }
      fulfillLabel = `DELIVERY on ${fulfillDate}: ${a.street}, ${a.city}, MI ${a.zip}`;
    } else {
      fulfillLabel = `PICKUP on ${fulfillDate}`;
    }
  }

  // ---- Price the cart from config (never trust client prices) ----
  const lineItems = [];
  const summaryParts = [];
  for (const entry of cart) {
    const item = (CONFIG.items || []).find(i => i.id === entry.id);
    const qty = parseInt(entry.qty, 10);
    if (!item || !qty || qty < 1 || qty > 50) {
      return json(400, { error: "Invalid item in cart" });
    }
    lineItems.push({
      name: item.name,
      quantity: String(qty),
      basePriceMoney: {
        amount: BigInt(Math.round(item.price * 100)),
        currency: "USD"
      }
    });
    summaryParts.push(`${item.name} x${qty}`);
  }

  if (fulfillment.type === "delivery" && S.deliveryFee > 0) {
    lineItems.push({
      name: "Delivery Fee",
      quantity: "1",
      basePriceMoney: {
        amount: BigInt(Math.round(S.deliveryFee * 100)),
        currency: "USD"
      }
    });
  }

  const client = new SquareClient({
    token: process.env.SQUARE_ACCESS_TOKEN,
    environment: process.env.SQUARE_ENVIRONMENT === "production"
      ? SquareEnvironment.Production
      : SquareEnvironment.Sandbox,
  });

  const locationId = process.env.SQUARE_LOCATION_ID;
  if (!locationId) return json(500, { error: "SQUARE_LOCATION_ID env var not set" });

  const orderNote = [
    `Web order — ${customer.firstName} ${customer.lastName}`,
    `Phone: ${customer.phone}`,
    fulfillLabel,
    fulfillment.notes ? `Notes: ${fulfillment.notes}` : ""
  ].filter(Boolean).join(" | ");

  // Proper PICKUP fulfillment for pickup + event orders (shows recipient name
  // on the order ticket in your dashboard). Delivery details ride in the note.
  const pickupFulfillments = (fulfillment.type === "pickup" || fulfillment.type === "event")
    ? [{
        type: "PICKUP",
        pickupDetails: {
          recipient: {
            displayName: `${customer.firstName} ${customer.lastName}`,
            emailAddress: customer.email,
            phoneNumber: customer.phone
          },
          pickupAt: `${fulfillDate}T10:00:00-05:00`,
          note: fulfillLabel
        }
      }]
    : undefined;

  const buildRequest = (withFulfillment) => ({
    idempotencyKey: `chk-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    order: {
      locationId,
      lineItems,
      note: orderNote,
      ...(withFulfillment && pickupFulfillments ? { fulfillments: pickupFulfillments } : {})
    },
    checkoutOptions: {
      redirectUrl: (process.env.URL || "") + "/?order=success",
      askForShippingAddress: false,
      merchantSupportEmail: process.env.SUPPORT_EMAIL || undefined
    },
    prePopulatedData: {
      buyerEmail: customer.email,
      buyerPhoneNumber: normalizePhone(customer.phone)
    }
  });

  try {
    let linkRes;
    try {
      linkRes = await client.checkout.paymentLinks.create(buildRequest(true));
    } catch (firstErr) {
      // If the fulfillment object is rejected by the account/location config,
      // retry once without it so the sale isn't lost — details survive in the note.
      if (pickupFulfillments && firstErr.statusCode === 400) {
        console.error("Fulfillment rejected, retrying without it:", firstErr.message);
        linkRes = await client.checkout.paymentLinks.create(buildRequest(false));
      } else {
        throw firstErr;
      }
    }

    const url = linkRes.paymentLink && linkRes.paymentLink.url;
    if (!url) throw new Error("Payment link created but no URL returned");

    // Optional heads-up ping to n8n (payment itself will trigger Square's own
    // push + email notification once the customer pays)
    if (process.env.N8N_ORDER_WEBHOOK_URL) {
      try {
        await fetch(process.env.N8N_ORDER_WEBHOOK_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            source: "suttonlysweet.com",
            kind: "checkout-started",
            customer: `${customer.firstName} ${customer.lastName}`,
            phone: customer.phone,
            email: customer.email,
            items: summaryParts.join(", "),
            fulfillment: fulfillLabel
          })
        });
      } catch (e) {
        console.error("n8n ping failed:", e.message);
      }
    }

    return json(200, { success: true, checkoutUrl: url });

  } catch (err) {
    console.error("Square checkout error:", err && err.message ? err.message : err);
    return json(500, { error: "Failed to create checkout", detail: (err && err.message) || "Unknown error" });
  }
};

function normalizePhone(p) {
  const digits = String(p).replace(/\D/g, "");
  if (digits.length === 10) return "+1" + digits;
  if (digits.length === 11 && digits.startsWith("1")) return "+" + digits;
  return undefined; // let Square's page collect it if format is odd
}

function json(statusCode, obj) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(obj)
  };
}
