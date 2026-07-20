const { SquareClient, SquareEnvironment } = require("square");

const GROUP_NAME = "Website Loyalty List";

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

  const email = (body.email || "").trim().toLowerCase();
  const firstName = (body.firstName || "").trim();

  // Honeypot — bots fill every field
  if (body.website) return json(200, { success: true });

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json(400, { error: "Please enter a valid email." });
  }

  const client = new SquareClient({
    token: process.env.SQUARE_ACCESS_TOKEN,
    environment: process.env.SQUARE_ENVIRONMENT === "production"
      ? SquareEnvironment.Production
      : SquareEnvironment.Sandbox,
  });

  try {
    // Find or create the customer
    let customerId;
    const searchRes = await client.customers.search({
      query: { filter: { emailAddress: { exact: email } } }
    });

    if (searchRes.customers && searchRes.customers.length > 0) {
      customerId = searchRes.customers[0].id;
    } else {
      const createRes = await client.customers.create({
        idempotencyKey: `loyalty-${email}-${Date.now()}`,
        emailAddress: email,
        ...(firstName ? { givenName: firstName } : {}),
        note: "Joined via website loyalty list"
      });
      customerId = createRes.customer && createRes.customer.id;
    }
    if (!customerId) throw new Error("Could not create customer");

    // Find or create the loyalty group
    let groupId;
    const groupsRes = await client.customers.groups.list({});
    const existing = (groupsRes.data || groupsRes.groups || []).find
      ? (groupsRes.data || groupsRes.groups || []).find(g => g.name === GROUP_NAME)
      : null;

    if (existing) {
      groupId = existing.id;
    } else {
      // Handle paginated iterator shape if list() returns a Page
      let found = null;
      if (groupsRes && typeof groupsRes[Symbol.asyncIterator] === "function") {
        for await (const g of groupsRes) {
          if (g.name === GROUP_NAME) { found = g; break; }
        }
      }
      if (found) {
        groupId = found.id;
      } else {
        const createGroup = await client.customers.groups.create({
          idempotencyKey: `group-${Date.now()}`,
          group: { name: GROUP_NAME }
        });
        groupId = createGroup.group && createGroup.group.id;
      }
    }

    // Add customer to the group (idempotent — re-adding is harmless)
    if (groupId) {
      await client.customers.groups.add({ customerId, groupId });
    }

    return json(200, { success: true });

  } catch (err) {
    console.error("Loyalty list error:", err && err.message ? err.message : err);
    return json(500, { error: "Couldn't sign you up right now — please try again." });
  }
};

function json(statusCode, obj) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(obj)
  };
}
