const { Client, Environment } = require("square");

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

  // Basic validation
  if (!firstName || !lastName || !email || !phone || !itemType || !quantity || !dateNeeded) {
    return { statusCode: 400, body: JSON.stringify({ error: "Missing required fields" }) };
  }

  const client = new Client({
    accessToken: process.env.SQUARE_ACCESS_TOKEN,
    environment: process.env.SQUARE_ENVIRONMENT === "production"
      ? Environment.Production
      : Environment.Sandbox,
  });

  try {
    const idempotencyKey = `order-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    // Format the date for display
    const formattedDate = new Date(dateNeeded + "T00:00:00").toLocaleDateString("en-US", {
      weekday: "long", month: "long", day: "numeric", year: "numeric"
    });

    // Build line items
    const lineItems = [
      {
        name: `${itemType} — ${quantity}`,
        description: [
          occasion ? `Occasion: ${occasion}` : "",
          notes ? `Notes: ${notes}` : "",
          `Date Needed: ${formattedDate}`,
          referral ? `Heard about us: ${referral}` : ""
        ].filter(Boolean).join(" | "),
        quantity: "1",
        basePriceMoney: {
          amount: BigInt(0), // $0 placeholder — you set final price before sending
          currency: "USD"
        }
      }
    ];

    // Add delivery fee line item if applicable
    if (fulfillment === "delivery" && deliveryFee > 0) {
      lineItems.push({
        name: "Delivery Fee",
        description: address
          ? `${address.street}, ${address.city}, ${address.state} ${address.zip}`
          : "Flat rate delivery",
        quantity: "1",
        basePriceMoney: {
          amount: BigInt(deliveryFee * 100), // $10.00 = 1000 cents
          currency: "USD"
        }
      });
    }

    // Build invoice note
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

    // Create or find customer in Square
    let customerId;
    try {
      const searchRes = await client.customersApi.searchCustomers({
        query: {
          filter: {
            emailAddress: { exact: email }
          }
        }
      });

      if (searchRes.result.customers && searchRes.result.customers.length > 0) {
        customerId = searchRes.result.customers[0].id;
      } else {
        // Create new customer
        const createRes = await client.customersApi.createCustomer({
          idempotencyKey: `customer-${idempotencyKey}`,
          givenName: firstName,
          familyName: lastName,
          emailAddress: email,
          phoneNumber: phone
        });
        customerId = createRes.result.customer.id;
      }
    } catch (customerErr) {
      console.error("Customer create/find error:", customerErr);
      // Continue without customer ID — invoice will still create
    }

    // Get today's date for invoice
    const today = new Date();
    const invoiceDeliveryDate = today.toISOString().split("T")[0];

    // Build invoice payload
    const invoicePayload = {
      idempotencyKey,
      invoice: {
        orderId: undefined, // will use lineItems directly via order
        title: `Custom Order — ${firstName} ${lastName}`,
        description: invoiceNote,
        scheduledAt: invoiceDeliveryDate,
        deliveryMethod: "EMAIL",
        paymentRequests: [
          {
            requestType: "BALANCE",
            dueDate: dateNeeded, // due by the order date
            automaticPaymentSource: "NONE"
          }
        ],
        acceptedPaymentMethods: {
          card: true,
          squareGiftCard: false,
          bankAccount: false
        },
        ...(customerId ? { primaryRecipient: { customerId } } : {
          primaryRecipient: {
            givenName: firstName,
            familyName: lastName,
            emailAddress: email,
            phoneNumber: phone
          }
        })
      }
    };

    // First create an Order to attach to the invoice
    const locationId = process.env.SQUARE_LOCATION_ID;
    if (!locationId) throw new Error("SQUARE_LOCATION_ID env var not set");

    const orderRes = await client.ordersApi.createOrder({
      idempotencyKey: `sq-order-${idempotencyKey}`,
      order: {
        locationId,
        lineItems,
        state: "DRAFT"
      }
    });

    const sqOrderId = orderRes.result.order.id;

    // Now create the invoice referencing the order
    const invoiceRes = await client.invoicesApi.createInvoice({
      idempotencyKey,
      invoice: {
        ...invoicePayload.invoice,
        orderId: sqOrderId
      }
    });

    const invoiceId = invoiceRes.result.invoice.id;

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
    console.error("Square API error:", JSON.stringify(err, null, 2));
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        error: "Failed to create invoice",
        detail: err.message || "Unknown error"
      })
    };
  }
};
