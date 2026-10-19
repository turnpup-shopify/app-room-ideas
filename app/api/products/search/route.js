import { graphqlRequest } from '../../../../lib/shopify.js';

const SEARCH_QUERY = `
  query searchProducts($query: String) {
    products(first: 25, sortKey: UPDATED_AT, reverse: true, query: $query) {
      edges {
        node {
          id
          title
          handle
          productType
          featuredImage {
            url
          }
        }
      }
    }
  }
`;

export async function GET(request) {
  const domain = process.env.SHOPIFY_STORE_DOMAIN;
  const token = process.env.SHOPIFY_ACCESS_TOKEN;

  if (!domain || !token) {
    return Response.json({ error: 'Missing Shopify credentials' }, { status: 500 });
  }

  const { searchParams } = new URL(request.url);
  const q = searchParams.get('q')?.trim() || '';

  // When q is provided, search by title; otherwise return most recently updated
  const shopifyQuery = q ? `title:*${q}*` : null;

  try {
    const data = await graphqlRequest(domain, token, SEARCH_QUERY, { query: shopifyQuery });

    const products = data.products.edges.map(({ node }) => ({
      id: node.id,
      title: node.title,
      handle: node.handle,
      productType: node.productType || '',
      thumbnail: node.featuredImage?.url || null,
    }));

    return Response.json(products);
  } catch (err) {
    console.error('[products/search]', err);
    return Response.json({ error: err.message }, { status: 500 });
  }
}
