// netlify/functions/decline-order.js
// Called when owner clicks Decline in the dashboard
// Sends a polite decline email to the customer via Resend

const { Resend } = require("resend");

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

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
    customerEmail,
    requestDate,
    declineReason, // optional message from owner
  } = body;

  try {
    const resend = new Resend(process.env.RESEND_API_KEY);

    await resend.emails.send({
      from: "Suttonly Sweet <orders@suttonlysweet.com>",
      to: customerEmail,
      subject: `Your Order Request — Suttonly Sweet`,
      html: `
        <div style="font-family:'DM Sans',Arial,sans-serif;max-width:560px;margin:0 auto;background:#fff;">
          <div style="background:#E8177A;padding:32px;text-align:center;border-radius:16px 16px 0 0;">
            <h1 style="color:white;margin:0;font-size:1.4rem;">Suttonly Sweet 🎂</h1>
          </div>

          <div style="padding:32px;">
            <p style="font-size:1rem;color:#1a1a1a;">Hi ${customerFirstName},</p>

            <p style="color:#555;line-height:1.7;">
              Thank you so much for reaching out! Unfortunately we're unable to fulfill your order
              request for <strong>${requestDate}</strong> at this time.
            </p>

            ${declineReason ? `
            <div style="background:#fff5fa;border-left:3px solid #E8177A;padding:16px;border-radius:8px;margin:20px 0;">
              <p style="margin:0;color:#555;">${declineReason}</p>
            </div>
            ` : ""}

            <p style="color:#555;line-height:1.7;">
              We'd love to bake for you — please try another date or give us a call to discuss
              your order directly. We'll do our best to make it work!
            </p>

            <div style="text-align:center;margin:32px 0;">
              <a href="https://suttonlysweet.com/order"
                 style="background:#E8177A;color:white;padding:14px 32px;border-radius:100px;text-decoration:none;font-weight:700;display:inline-block;">
                Try Another Date
              </a>
            </div>

            <p style="color:#999;font-size:0.85rem;">
              Questions? Reply to this email or text us directly.
            </p>
          </div>

          <div style="background:#f4f4f6;padding:20px;text-align:center;border-radius:0 0 16px 16px;">
            <p style="color:#999;font-size:0.75rem;margin:0;">
              Suttonly Sweet · Detroit, MI · suttonlysweet.com
            </p>
          </div>
        </div>
      `,
    });

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        success: true,
        message: `Decline email sent to ${customerEmail}`,
      }),
    };
  } catch (err) {
    console.error("Decline order error:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ success: false, error: err.message }),
    };
  }
};
