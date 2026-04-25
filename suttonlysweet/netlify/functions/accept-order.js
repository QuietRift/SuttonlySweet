// netlify/functions/accept-order.js
// Called when owner clicks "Accept & Invoice" in the dashboard
// 1. Creates or finds the customer in Square
// 2. Creates a Square Invoice
// 3. Sends the invoice directly to the customer's email

const { Client, Environment } = require("squareup");
const { Resend } = require("resend");

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  // Basic auth check — dashboard sends the secret header
  const secret = event.headers["x-dashboard-secret"];
  if (secret !== process.env.DASHBOARD_SECRET) {
    return { statusCode: 401, body: "Unauthorized" };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: "Invalid JSON" };
  }

  const {
    orderId,
    customerFirstName,
    customerLastName,
    customerEmail,
    customerPhone,
    items,        // array of { squareItemId, name, qty, price }
    requestDate,
    requestTime,
    orderType,
    notes,
  } = body;

  const client = new Client({
    accessToken: process.env.SQUARE_ACCESS_TOKEN,
    environment:
      process.env.SQUARE_ENVIRONMENT === "production"
        ? Environment.Production
        : Environment.Sandbox,
  });

  try {
    // ── STEP 1: Create or find customer in Square ──────
    let squareCustomerId;

    const searchResponse = await client.customersApi.searchCustomers({
      query: {
        filter: {
          emailAddress: { exact: customerEmail },
        },
      },
    });

    if (searchResponse.result.customers?.length > 0) {
      // Customer already exists
      squareCustomerId = searchResponse.result.customers[0].id;
    } else {
      // Create new customer
      const createResponse = await client.customersApi.createCustomer({
        idempotencyKey: `${orderId}-customer`,
        givenName: customerFirstName,
        familyName: customerLastName,
        emailAddress: customerEmail,
        phoneNumber: customerPhone,
        referenceId: orderId,
      });
      squareCustomerId = createResponse.result.customer.id;
    }

    // ── STEP 2: Build invoice line items ───────────────
    const lineItems = items.map((item) => ({
      name: item.name,
      quantity: String(item.qty),
      basePriceMoney: {
        amount: BigInt(Math.round(item.price * 100)),
        currency: "USD",
      },
    }));

    // ── STEP 3: Create Square Order ────────────────────
    const orderResponse = await client.ordersApi.createOrder({
      idempotencyKey: `${orderId}-order`,
      order: {
        locationId: process.env.SQUARE_LOCATION_ID,
        customerId: squareCustomerId,
        lineItems,
        metadata: {
          suttonlyOrderId: orderId,
          requestDate,
          requestTime,
          orderType,
          notes: notes || "",
        },
      },
    });

    const squareOrderId = orderResponse.result.order.id;

    // ── STEP 4: Create & publish Square Invoice ────────
    // Due date = 24 hours from now (customer must pay to confirm order)
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + 1);
    const dueDateString = dueDate.toISOString().split("T")[0];

    const invoiceResponse = await client.invoicesApi.createInvoice({
      idempotencyKey: `${orderId}-invoice`,
      invoice: {
        locationId: process.env.SQUARE_LOCATION_ID,
        orderId: squareOrderId,
        primaryRecipient: {
          customerId: squareCustomerId,
        },
        paymentRequests: [
          {
            requestType: "BALANCE",
            dueDate: dueDateString,
            automaticPaymentSource: "NONE",
            reminders: [
              {
                relativeScheduledDays: -1,
                message: "Friendly reminder — your Suttonly Sweet order invoice is due tomorrow!",
              },
            ],
          },
        ],
        deliveryMethod: "EMAIL",
        invoiceNumber: orderId,
        title: `Suttonly Sweet — Order ${orderId}`,
        description: `Thank you for your order! ${orderType === "delivery" ? "We'll deliver on" : "Pickup on"} ${requestDate} between ${requestTime}. Pay this invoice to confirm your order.`,
        acceptedPaymentMethods: {
          card: true,
          squareGiftCard: false,
          bankAccount: false,
          buyNowPayLater: false,
        },
      },
    });

    const invoiceId = invoiceResponse.result.invoice.id;

    // ── STEP 5: Publish the invoice (sends email to customer) ──
    await client.invoicesApi.publishInvoice(invoiceId, {
      idempotencyKey: `${orderId}-publish`,
      version: 0,
    });

    // ── STEP 6: Notify owner that invoice was sent ─────
    try {
      const resend = new Resend(process.env.RESEND_API_KEY);
      await resend.emails.send({
        from: "Suttonly Sweet <orders@suttonlysweet.com>",
        to: process.env.OWNER_EMAIL,
        subject: `✅ Invoice Sent — ${orderId} to ${customerFirstName} ${customerLastName}`,
        html: `
          <div style="font-family:Arial,sans-serif;max-width:500px;margin:0 auto;">
            <div style="background:#2D6B4A;padding:24px;border-radius:12px 12px 0 0;text-align:center;">
              <h2 style="color:white;margin:0;">Invoice Sent ✅</h2>
            </div>
            <div style="padding:24px;background:white;">
              <p>Invoice <strong>${orderId}</strong> has been sent to <strong>${customerEmail}</strong>.</p>
              <p>They have until <strong>${dueDateString}</strong> to pay and confirm the order.</p>
              <p>You'll receive a notification when payment is made.</p>
            </div>
          </div>
        `,
      });
    } catch (e) {
      console.error("Owner notification email failed:", e);
    }

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        success: true,
        invoiceId,
        squareOrderId,
        message: `Invoice sent to ${customerEmail}`,
      }),
    };
  } catch (err) {
    console.error("Accept order error:", err);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        success: false,
        error: err.message || "Failed to process order",
      }),
    };
  }
};
