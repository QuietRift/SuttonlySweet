// netlify/functions/get-menu.js
// Fetches live menu items from Square Catalog API
// Called by order.html on page load to populate the dropdown

const { Client, Environment } = require("square");

exports.handler = async () => {
  try {
    const client = new Client({
      accessToken: process.env.SQUARE_ACCESS_TOKEN,
      environment:
        process.env.SQUARE_ENVIRONMENT === "production"
          ? Environment.Production
          : Environment.Sandbox,
    });

    // Fetch all catalog items
    const response = await client.catalogApi.listCatalog(undefined, "ITEM");

    if (!response.result.objects) {
      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: [] }),
      };
    }

    // Shape the data for the frontend
    const items = response.result.objects
      .filter((obj) => obj.type === "ITEM" && obj.itemData)
      .map((obj) => {
        const item = obj.itemData;
        const variation = item.variations?.[0];
        const priceMoney = variation?.itemVariationData?.priceMoney;
        const priceInCents = priceMoney?.amount || 0;

        return {
          id: obj.id,
          name: item.name,
          description: item.description || "",
          category: item.categoryId || "Other",
          price: priceInCents / 100, // convert cents to dollars
          imageId: item.imageIds?.[0] || null,
        };
      })
      .filter((item) => item.name); // remove any unnamed items

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=300", // cache 5 min
      },
      body: JSON.stringify({ items }),
    };
  } catch (err) {
    console.error("Square Catalog error:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Failed to load menu", items: [] }),
    };
  }
};
