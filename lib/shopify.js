// Shopify Admin GraphQL client
// Fetches all active Uttermost products with inventory, design_style, materials, and images

const PRODUCTS_QUERY = `
  query fetchProducts($cursor: String) {
    products(first: 50, after: $cursor) {
      pageInfo {
        hasNextPage
        endCursor
      }
      edges {
        node {
          id
          title
          productType
          vendor
          totalInventory
          images(first: 5) {
            edges {
              node {
                src
                altText
              }
            }
          }
          designStyle: metafield(namespace: "custom", key: "design_style") {
            value
          }
          materials: metafield(namespace: "custom", key: "materials") {
            value
          }
          dimensions: metafield(namespace: "pdp", key: "dimensions") {
            value
          }
        }
      }
    }
  }
`;

async function graphqlRequest(domain, token, query, variables = {}) {
  const url = `https://${domain}/admin/api/2024-01/graphql.json`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': token,
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Shopify API error ${response.status}: ${text}`);
  }

  const json = await response.json();

  if (json.errors) {
    throw new Error(`GraphQL errors: ${JSON.stringify(json.errors)}`);
  }

  return json.data;
}

/**
 * Fetch all products from Shopify, filtered by vendor and inventory.
 * Returns a normalized array of product objects.
 *
 * @param {Object} config - Loaded config.json
 * @returns {Promise<Array>} products
 */
export async function fetchProducts(config) {
  const domain = process.env.SHOPIFY_STORE_DOMAIN;
  const token = process.env.SHOPIFY_ACCESS_TOKEN;

  if (!domain || !token) {
    throw new Error(
      'Missing SHOPIFY_STORE_DOMAIN or SHOPIFY_ACCESS_TOKEN environment variables.'
    );
  }

  const { includeVendors, requireInventory } = config;
  const allProducts = [];
  let cursor = null;

  while (true) {
    const data = await graphqlRequest(domain, token, PRODUCTS_QUERY, { cursor });
    const { edges, pageInfo } = data.products;

    for (const { node } of edges) {
      // Vendor filter
      if (includeVendors?.length > 0 && !includeVendors.includes(node.vendor)) continue;

      // Inventory filter
      if (requireInventory && node.totalInventory <= 0) continue;

      // Parse design_style (stored as JSON array string, e.g. '["Coastal","Modern"]')
      let designStyles = [];
      if (node.designStyle?.value) {
        try {
          designStyles = JSON.parse(node.designStyle.value);
        } catch {
          designStyles = [node.designStyle.value];
        }
      }

      // Skip products with no design_style
      if (designStyles.length === 0) continue;

      const images = node.images.edges.map((e) => e.node.src);

      allProducts.push({
        id: node.id,
        title: node.title,
        productType: node.productType || '',
        vendor: node.vendor,
        totalInventory: node.totalInventory,
        designStyles,
        materials: node.materials?.value || '',
        dimensions: node.dimensions?.value || '',
        images,
      });
    }

    if (!pageInfo.hasNextPage) break;
    cursor = pageInfo.endCursor;
  }

  return allProducts;
}
