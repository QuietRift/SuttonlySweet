// netlify/functions/square-webhook.js
// Listens for Square payment events
// When a customer pays their invoice, owner gets a notification

const { Resend } = require("resend");
const crypto = require("crypto");

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  // ── Verify webhook signature from Square ───────────────
  // This ensures the request actually came from Square
  const signature = event.headers["x-square-hmacsha256-signature"];
  const webhookSecret = process.env.SQUARE_WEBHOOK_SIGNATURE_KEY;

  if (webhookSecret && signature) {
    const url = `${process.env.URL}/.netlify/functions/square-webhook`;
    const hmac = crypto.createHmac("sha256", webhookSecret);
    hmac.update(url + event.body);
    const expectedSig = hmac.digest("base64");

    if (signature !== expectedSig) {
      console.error("Webhook signature mismatch");
      return { statusCode: 401, body: "Invalid signature" };
    }
  }

  let payload;
  try {
    payload = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: "Invalid JSON" };
  }

  const eventType = payload.type;
  console.log("Square webhook event:", eventType);

  // ── Handle invoice paid ────────────────────────────────
  if (eventType === "invoice.payment_made") {
    const invoice = payload.data?.object?.invoice;
    const orderId = invoice?.invoiceNumber || "Unknown";
    const customerEmail = invoice?.primaryRecipient?.emailAddress;
    const customerName = invoice?.primaryRecipient?.givenName;
    const amountPaid = invoice?.paymentRequests?.[0]?.totalCompletedAmountMoney?.amount;
    const amountFormatted = amountPaid ? `$${(Number(amountPaid) / 100).toFixed(2)}` : "—";

    // Notify owner
    try {
      const resend = new Resend(process.env.RESEND_API_KEY);

      await resend.emails.send({
        from: "Suttonly Sweet <orders@suttonlysweet.com>",
        to: process.env.OWNER_EMAIL,
        subject: `💰 Payment Received — ${orderId} — ${amountFormatted}`,
        html: `
          <div style="font-family:Arial,sans-serif;max-width:500px;margin:0 auto;">
            <div style="background:#2D6B4A;padding:24px;border-radius:12px 12px 0 0;text-align:center;">
              <h2 style="color:white;margin:0;">Payment Received 💰</h2>
            </div>
            <div style="padding:24px;background:white;">
              <p style="font-size:1.1rem;"><strong>${amountFormatted}</strong> received for order <strong>${orderId}</strong>.</p>
              <p>Customer: <strong>${customerName || "—"}</strong> (${customerEmail || "—"})</p>
              <p style="color:#2D6B4A;font-weight:600;">This order is now confirmed. Check your Square dashboard for full details.</p>
              <div style="text-align:center;margin-top:24px;">
                <a href="https://squareup.com/dashboard" 
                   style="background:#2D6B4A;color:white;padding:12px 28px;border-radius:100px;text-decoration:none;font-weight:700;display:inline-block;">
                  View in Square →
                </a>
              </div>
            </div>
          </div>
        `,
      });
    } catch (e) {
      console.error("Payment notification email failed:", e);
    }
  }

  // ── Handle invoice reminder sent (optional logging) ────
  if (eventType === "invoice.payment_reminder_sent") {
    console.log("Payment reminder sent for invoice:", payload.data?.object?.invoice?.invoiceNumber);
  }

  return { statusCode: 200, body: "OK" };
};
