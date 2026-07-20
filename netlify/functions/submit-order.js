const { SquareClient, SquareEnvironment } = require("square");
const CONFIG = require("../../shop-config.json");

exports.handler = async function (event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  let order;
  try {
    order = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: "Invalid request body" }) };
  }

  const {
    firstName, lastName, email, phone,
    itemType, quantity, dateNeeded, occasion,
    fulfillment, deliveryFee, address, notes, referral
  } = order;

  if (!firstName || !lastName || !email || !phone || !itemType || !quantity || !dateNeeded) {
    return { statusCode: 400, body: JSON.stringify({ error: "Missing required fields" }) };
  }

  // Lead time — server-side backstop (mobile pickers can bypass the client rule)
  const leadDays = (CONFIG.settings && CONFIG.settings.minLeadDays) || 4;
  const nowDetroit = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Detroit" }));
  const minDate = new Date(nowDetroit.getFullYear(), nowDetroit.getMonth(), nowDetroit.getDate() + leadDays);
  const chosenDate = new Date(dateNeeded + "T00:00:00");
  if (isNaN(chosenDate) || chosenDate < minDate) {
    return { statusCode: 400, body: JSON.stringify({ error: `Orders need at least ${leadDays} days' notice. Please pick a later date.` }) };
  }

  const client = new SquareClient({
    token: process.env.SQUARE_ACCESS_TOKEN,
    environment: process.env.SQUARE_ENVIRONMENT === "production"
      ? SquareEnvironment.Production
      : SquareEnvironment.Sandbox,
  });

  try {
    const idempotencyKey = `order-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const formattedDate = new Date(dateNeeded + "T00:00:00").toLocaleDateString("en-US", {
      weekday: "long", month: "long", day: "numeric", year: "numeric"
    });

    // Build line items
    const lineItems = [
      {
        name: `${itemType} — ${quantity}`,
        note: [
          occasion ? `Occasion: ${occasion}` : "",
          `Needed: ${formattedDate}`
        ].filter(Boolean).join(" | "),
        quantity: "1",
        basePriceMoney: {
          amount: BigInt(100), // $1 placeholder — set final price in dashboard before sending
          currency: "USD"
        }
      }
    ];

    if (fulfillment === "delivery" && deliveryFee > 0) {
      lineItems.push({
        name: "Delivery Fee",
        note: address
          ? `${address.street}, ${address.city}, ${address.state} ${address.zip}`
          : "Flat rate delivery",
        quantity: "1",
        basePriceMoney: {
          amount: BigInt(Math.round(deliveryFee * 100)),
          currency: "USD"
        }
      });
    }

    const invoiceNote = [
      `Order Request from Suttonly Sweet Website`,
      `Customer: ${firstName} ${lastName}`,
      `Phone: ${phone}`,
      `Email: ${email}`,
      `Item: ${itemType}`,
      `Quantity: ${quantity}`,
      `Date Needed: ${formattedDate}`,
      occasion ? `Occasion: ${occasion}` : "",
      `Fulfillment: ${fulfillment === "delivery" ? "Delivery" : "Pickup"}`,
      fulfillment === "delivery" && address
        ? `Delivery Address: ${address.street}, ${address.city}, ${address.state} ${address.zip}`
        : "",
      notes ? `Special Instructions: ${notes}` : "",
      referral ? `How they found us: ${referral}` : "",
      ``,
      `⚠️ Update line item price before sending invoice to customer.`
    ].filter(Boolean).join("\n");

    // Find or create the customer (new SDK: client.customers, responses are unwrapped)
    let customerId;
    try {
      const searchRes = await client.customers.search({
        query: { filter: { emailAddress: { exact: email } } }
      });

      if (searchRes.customers && searchRes.customers.length > 0) {
        customerId = searchRes.customers[0].id;
      } else {
        const createRes = await client.customers.create({
          idempotencyKey: `customer-${idempotencyKey}`,
          givenName: firstName,
          familyName: lastName,
          emailAddress: email,
          phoneNumber: phone
        });
        customerId = createRes.customer && createRes.customer.id;
      }
    } catch (customerErr) {
      console.error("Customer create/find error:", customerErr);
      // Continue — invoice can still be created with recipient details
    }

    const locationId = process.env.SQUARE_LOCATION_ID;
    if (!locationId) throw new Error("SQUARE_LOCATION_ID env var not set");

    // Create the draft Order
    const orderRes = await client.orders.create({
      idempotencyKey: `sq-order-${idempotencyKey}`,
      order: {
        locationId,
        lineItems,
        state: "OPEN", // Invoices API requires OPEN orders
        ...(customerId ? { customerId } : {})
      }
    });

    const sqOrderId = orderRes.order.id;

    // Create the draft invoice referencing the order.
    // No scheduledAt: you review and hit Send manually in the dashboard.
    const invoiceRes = await client.invoices.create({
      idempotencyKey,
      invoice: {
        orderId: sqOrderId,
        locationId,
        title: `Custom Order — ${firstName} ${lastName}`,
        description: invoiceNote,
        deliveryMethod: "EMAIL",
        paymentRequests: [
          {
            requestType: "BALANCE",
            dueDate: dateNeeded,
            automaticPaymentSource: "NONE"
          }
        ],
        acceptedPaymentMethods: {
          card: true,
          squareGiftCard: false,
          bankAccount: false
        },
        ...(customerId
          ? { primaryRecipient: { customerId } }
          : {
              primaryRecipient: {
                givenName: firstName,
                familyName: lastName,
                emailAddress: email,
                phoneNumber: phone
              }
            })
      }
    });

    const invoiceId = invoiceRes.invoice && invoiceRes.invoice.id;

    // ---- Notify the owner (fire both legs; never fail the order over a ping) ----
    const summaryLines = [
      `${firstName} ${lastName} — ${itemType} (${quantity})`,
      `Needed: ${formattedDate} | ${fulfillment === "delivery" ? "Delivery" : "Pickup"}`,
      `Phone: ${phone} | Email: ${email}`,
      notes ? `Notes: ${notes}` : "",
      `Draft invoice: ${invoiceId || "created"}`
    ].filter(Boolean).join("\n");

    // Leg 1: Netlify Forms → triggers Netlify email notification
    // (requires the hidden order-notification form in index.html)
    if (process.env.URL) {
      try {
        await fetch(process.env.URL + "/", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            "form-name": "order-notification",
            customer: `${firstName} ${lastName}`,
            email,
            phone,
            item: `${itemType} (${quantity})`,
            "date-needed": formattedDate,
            summary: summaryLines
          }).toString()
        });
      } catch (e) {
        console.error("Netlify Forms notification failed:", e.message);
      }
    }

    // Leg 2 (optional): n8n webhook for Telegram/push alerts
    if (process.env.N8N_ORDER_WEBHOOK_URL) {
      try {
        await fetch(process.env.N8N_ORDER_WEBHOOK_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            source: "suttonlysweet.com",
            invoiceId,
            customer: `${firstName} ${lastName}`,
            email, phone, itemType, quantity,
            dateNeeded, occasion, fulfillment, notes, referral
          })
        });
      } catch (e) {
        console.error("n8n webhook notification failed:", e.message);
      }
    }

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        success: true,
        invoiceId,
        message: "Order request received. Draft invoice created in Square."
      })
    };

  } catch (err) {
    console.error("Square API error:", err && err.message ? err.message : err);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        error: "Failed to create invoice",
        detail: (err && err.message) || "Unknown error"
      })
    };
  }
};
