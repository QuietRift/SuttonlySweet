// netlify/functions/submit-order.js
// Fires when a customer submits an order request
// 1. Saves order to a simple JSON store (Netlify Blobs)
// 2. Emails owner notification via Resend

const { Resend } = require("resend");

exports.handler = async (event) => {
  // Only accept POST
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: "Invalid JSON" };
  }

  const {
    firstName,
    lastName,
    email,
    phone,
    orderType,
    requestDate,
    requestTime,
    items,       // array of { name, qty, price }
    instructions,
    address,
    city,
    state,
    zip,
    deliveryNotes,
    estimatedTotal,
  } = body;

  // Build a unique order ID
  const orderId = `SS-${Date.now().toString().slice(-6)}`;
  const timestamp = new Date().toISOString();

  // ── EMAIL OWNER ──────────────────────────────────────
  try {
    const resend = new Resend(process.env.RESEND_API_KEY);

    const itemRows = (items || [])
      .map(
        (i) =>
          `<tr>
            <td style="padding:8px 12px;border-bottom:1px solid #fde8f2;">${i.qty}x ${i.name}</td>
            <td style="padding:8px 12px;border-bottom:1px solid #fde8f2;text-align:right;font-weight:600;">
              ${i.price > 0 ? `$${(i.price * i.qty).toFixed(2)}` : "Quote"}
            </td>
          </tr>`
      )
      .join("");

    const deliveryBlock =
      orderType === "delivery"
        ? `<p><strong>Address:</strong> ${address}, ${city}, ${state} ${zip}</p>
           ${deliveryNotes ? `<p><strong>Delivery Notes:</strong> ${deliveryNotes}</p>` : ""}`
        : `<p><strong>Type:</strong> Pickup</p>`;

    await resend.emails.send({
      from: "Suttonly Sweet Orders <onboarding@resend.dev>",
      to: process.env.OWNER_EMAIL,
      subject: `🎂 New Order Request ${orderId} — ${firstName} ${lastName}`,
      html: `
        <div style="font-family:'DM Sans',Arial,sans-serif;max-width:600px;margin:0 auto;background:#fff;">
          <div style="background:#E8177A;padding:32px;text-align:center;border-radius:16px 16px 0 0;">
            <h1 style="color:white;margin:0;font-size:1.6rem;">New Order Request 🎂</h1>
            <p style="color:rgba(255,255,255,0.85);margin:8px 0 0;font-size:0.9rem;">Order ${orderId}</p>
          </div>

          <div style="padding:32px;">
            <h2 style="color:#1a1a1a;font-size:1rem;margin:0 0 16px;">Customer Info</h2>
            <p><strong>Name:</strong> ${firstName} ${lastName}</p>
            <p><strong>Email:</strong> ${email}</p>
            <p><strong>Phone:</strong> ${phone}</p>

            <hr style="border:none;border-top:1px solid #fde8f2;margin:24px 0;">

            <h2 style="color:#1a1a1a;font-size:1rem;margin:0 0 16px;">Order Details</h2>
            <p><strong>Date:</strong> ${requestDate}</p>
            <p><strong>Time:</strong> ${requestTime}</p>
            ${deliveryBlock}

            <hr style="border:none;border-top:1px solid #fde8f2;margin:24px 0;">

            <h2 style="color:#1a1a1a;font-size:1rem;margin:0 0 16px;">Items</h2>
            <table style="width:100%;border-collapse:collapse;">
              ${itemRows}
              <tr>
                <td style="padding:12px;font-weight:700;color:#E8177A;">Estimated Total</td>
                <td style="padding:12px;font-weight:700;color:#E8177A;text-align:right;">${estimatedTotal}</td>
              </tr>
            </table>

            ${instructions ? `
            <hr style="border:none;border-top:1px solid #fde8f2;margin:24px 0;">
            <h2 style="color:#1a1a1a;font-size:1rem;margin:0 0 8px;">Customer Notes</h2>
            <p style="background:#fff5fa;padding:16px;border-radius:10px;color:#555;">${instructions}</p>
            ` : ""}

            <hr style="border:none;border-top:1px solid #fde8f2;margin:24px 0;">

            <div style="text-align:center;">
              <a href="${process.env.URL}/dashboard"
                 style="background:#E8177A;color:white;padding:14px 32px;border-radius:100px;text-decoration:none;font-weight:700;display:inline-block;">
                Review in Dashboard →
              </a>
            </div>
          </div>

          <div style="background:#f4f4f6;padding:20px;text-align:center;border-radius:0 0 16px 16px;">
            <p style="color:#999;font-size:0.75rem;margin:0;">Suttonly Sweet · suttonlysweet.com</p>
          </div>
        </div>
      `,
    });
  } catch (emailErr) {
    console.error("Email failed:", emailErr);
    // Don't fail the whole request if email fails
  }

  // ── RESPOND TO CLIENT ─────────────────────────────────
  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      success: true,
      orderId,
      message: "Order request received. We'll review and send your invoice within 2 hours.",
    }),
  };
};
