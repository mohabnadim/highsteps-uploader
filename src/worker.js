import refSneaker from './refs/ref-sneaker.jpg';
import refBag from './refs/ref-bag.jpg';
import refBelt from './refs/ref-belt.jpg';

const STYLE_PROMPT = `You are a luxury e-commerce product photographer.

The first {N} image(s) are STYLE REFERENCES from our shop. The LAST image is a raw photo of the product to reshoot.

Produce a new photo of the product from the LAST image, matching the reference style exactly:
- Seamless warm cream / ivory paper backdrop, very subtle gradient (slightly lighter at the top), no visible horizon line, no props.
- Soft, large, diffused studio light from the front-left; gentle natural contact shadow directly under the product; no harsh reflections or blown highlights.
- Product centered, filling about 65-75% of the frame height, even breathing room on all sides.
- Portrait 4:5 framing, eye-level or slightly elevated camera, realistic lens with no distortion.
- Crisp focus across the whole product, true-to-life colors, clean high-end retouching.

The product must stay 100% identical to the LAST image: same shape, proportions, colors, material texture, stitching, hardware, logos and any text. Do not redesign, add, remove, or "improve" any part of the product. If it is a pair, keep both items.
Remove everything that is not the product: hands, floor, clutter, tags, packaging (unless the notes ask for it).
Keep the product's viewing angle from the LAST image unless the notes say otherwise.
Output only the photograph: no text, no watermark, no border.`;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    try {
      if (!(await authorized(request, env))) return json({ error: 'Wrong staff password' }, 401);
      const route = `${request.method} ${url.pathname}`;
      switch (route) {
        case 'POST /api/login': {
          // Check the Shopify connection up front so setup problems show at login
          let shopifyError = null;
          try { await locationId(env); } catch (err) { shopifyError = err.message; }
          return json({ store: env.SHOPIFY_STORE, shopifyError, aiReshoot: Boolean(env.GEMINI_API_KEY) });
        }
        case 'GET /api/exists': return json(await findProduct(env, url.searchParams.get('title') || '', url.searchParams.get('id')));
        case 'POST /api/cutout': return cutout(env, request);
        case 'POST /api/restyle': return json(await restyle(env, await request.json()));
        case 'POST /api/upload': return json(await stageUpload(env, request));
        case 'POST /api/product': return json(await createProduct(env, await request.json()));
        default: return json({ error: 'Not found' }, 404);
      }
    } catch (err) {
      return json({ error: err.message || String(err) }, 500);
    }
  },
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
}

async function authorized(request, env) {
  const given = request.headers.get('x-staff-password') || '';
  if (!env.STAFF_PASSWORD) throw new Error('STAFF_PASSWORD is not set on the server');
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(given)),
    crypto.subtle.digest('SHA-256', enc.encode(env.STAFF_PASSWORD)),
  ]);
  return crypto.subtle.timingSafeEqual(a, b);
}

function toBase64(buf) {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

// ---------- Clean cutout: Cloudflare Images background removal ----------
async function cutout(env, request) {
  if (!request.body) throw new Error('No image sent');
  const result = await env.IMAGES.input(request.body)
    .transform({ segment: 'foreground' })
    .output({ format: 'image/png' });
  return result.response();
}

// ---------- Gemini restyle ----------
let refCache;
async function restyle(env, { image, notes }) {
  if (!env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is not set on the server');
  if (!image) throw new Error('No image sent');
  refCache ||= [refSneaker, refBag, refBelt].map(toBase64);
  const text = STYLE_PROMPT.replace('{N}', refCache.length) + (notes?.trim() ? `\n\nNotes:\n${notes.trim()}` : '');
  const parts = [
    ...refCache.map((data) => ({ inlineData: { mimeType: 'image/jpeg', data } })),
    { inlineData: { mimeType: 'image/jpeg', data: image } },
    { text },
  ];
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${env.GEMINI_MODEL}:generateContent`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
      body: JSON.stringify({
        contents: [{ role: 'user', parts }],
        generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: '4:5' } },
      }),
    },
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error?.message || `Gemini request failed (${res.status})`);
  const img = data.candidates?.[0]?.content?.parts?.find((p) => p.inlineData)?.inlineData;
  if (!img) {
    const reason = data.candidates?.[0]?.finishReason || data.promptFeedback?.blockReason || 'no image returned';
    throw new Error(`Gemini didn't return an image (${reason}). Try again.`);
  }
  return { image: img.data, mimeType: img.mimeType || 'image/png' };
}

// ---------- Shopify ----------
let tokenCache = { token: null, expires: 0 };
async function shopifyToken(env) {
  if (env.SHOPIFY_TOKEN) return env.SHOPIFY_TOKEN;
  if (!env.SHOPIFY_CLIENT_ID || !env.SHOPIFY_CLIENT_SECRET) throw new Error('Shopify credentials are not set on the server');
  if (tokenCache.token && Date.now() < tokenCache.expires) return tokenCache.token;
  const res = await fetch(`https://${env.SHOPIFY_STORE}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: env.SHOPIFY_CLIENT_ID,
      client_secret: env.SHOPIFY_CLIENT_SECRET,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) throw new Error(`Shopify login failed: ${data.error_description || data.error || res.status}`);
  tokenCache = { token: data.access_token, expires: Date.now() + (data.expires_in - 300) * 1000 };
  return tokenCache.token;
}

async function gql(env, query, variables) {
  const res = await fetch(`https://${env.SHOPIFY_STORE}/admin/api/${env.SHOPIFY_API_VERSION}/graphql.json`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-shopify-access-token': await shopifyToken(env) },
    body: JSON.stringify({ query, variables }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.errors) {
    const msg = Array.isArray(data.errors) ? data.errors.map((e) => e.message).join('; ') : data.errors || res.status;
    // Scopes may have just been granted; get a fresh token next time instead of the cached one
    if (/access denied/i.test(msg)) {
      tokenCache = { token: null, expires: 0 };
      // Say which scopes the app actually has, so the missing one is obvious
      const scopes = await gql(env, '{ currentAppInstallation { accessScopes { handle } } }')
        .then((d) => d.currentAppInstallation.accessScopes.map((s) => s.handle).join(', '))
        .catch(() => null);
      if (scopes !== null) throw new Error(`Shopify error: ${msg} The app currently has: ${scopes || 'no scopes'}`);
    }
    throw new Error(`Shopify error: ${msg}`);
  }
  return data.data;
}

function adminUrl(env, gid) {
  const store = env.SHOPIFY_STORE.replace('.myshopify.com', '');
  return `https://admin.shopify.com/store/${store}/products/${gid.split('/').pop()}`;
}

async function findProduct(env, title, id) {
  // An id from an earlier upload is checked first: it may have been deleted in Shopify since
  if (id) {
    const data = await gql(env, `query($id: ID!) { product(id: $id) { id title status } }`, { id: `gid://shopify/Product/${id.replace(/\D/g, '')}` });
    if (data.product) return { found: true, byId: true, status: data.product.status, url: adminUrl(env, data.product.id) };
  }
  if (!title) return { found: false };
  const q = `title:"${title.replace(/["\\]/g, '')}"`;
  const data = await gql(env, `query($q: String!) { products(first: 5, query: $q) { nodes { id title status } } }`, { q });
  const match = data.products.nodes.find((p) => p.title.toLowerCase() === title.toLowerCase());
  return match ? { found: true, status: match.status, url: adminUrl(env, match.id) } : { found: false };
}

async function stageUpload(env, request) {
  const filename = request.headers.get('x-filename') || 'photo.jpg';
  const mimeType = request.headers.get('content-type') || 'image/jpeg';
  const body = await request.arrayBuffer();
  const data = await gql(env, `
    mutation($input: [StagedUploadInput!]!) {
      stagedUploadsCreate(input: $input) {
        stagedTargets { url resourceUrl parameters { name value } }
        userErrors { field message }
      }
    }`, { input: [{ resource: 'IMAGE', filename, mimeType, httpMethod: 'POST', fileSize: String(body.byteLength) }] });
  const { stagedTargets, userErrors } = data.stagedUploadsCreate;
  if (userErrors.length) throw new Error(userErrors.map((e) => e.message).join('; '));
  const target = stagedTargets[0];
  const form = new FormData();
  for (const p of target.parameters) form.append(p.name, p.value);
  form.append('file', new Blob([body], { type: mimeType }), filename);
  const up = await fetch(target.url, { method: 'POST', body: form });
  if (!up.ok) throw new Error(`Image upload failed (${up.status})`);
  return { resourceUrl: target.resourceUrl };
}

let locationCache;
async function locationId(env) {
  if (locationCache) return locationCache;
  const data = await gql(env, `{ locations(first: 20, includeLegacy: true) { nodes { id isActive } } }`);
  const nodes = data.locations.nodes;
  locationCache = (nodes.find((l) => l.isActive) || nodes[0])?.id;
  if (!locationCache) throw new Error('Shopify has no location to keep stock in. Add one in Shopify admin → Settings → Locations.');
  return locationCache;
}

// p = { title, vendor, productType, descriptionHtml, tags, status, price, compareAtPrice,
//       colours: [{ name, images: [{ url, filename, alt }] }], sizes: [..], stock: { "colour|size": qty } }
async function createProduct(env, p) {
  if (!p.title?.trim()) throw new Error('Title is required');
  if (!(Number(p.price) > 0)) throw new Error('Price is required');
  const colours = p.colours?.length ? p.colours : [{ name: null, images: [] }];
  const named = colours.some((c) => c.name);
  const sizes = (p.sizes || []).filter(Boolean);
  const loc = await locationId(env);

  const productOptions = [];
  if (named) productOptions.push({ name: 'Colour', values: colours.map((c) => ({ name: c.name })) });
  if (sizes.length) productOptions.push({ name: 'Size', values: sizes.map((s) => ({ name: s })) });
  if (!productOptions.length) productOptions.push({ name: 'Title', values: [{ name: 'Default Title' }] });

  const fileInput = (img) => ({ originalSource: img.url, filename: img.filename, alt: img.alt || p.title, contentType: 'IMAGE' });
  const files = colours.flatMap((c) => c.images.map(fileInput));

  const variants = [];
  for (const c of colours) {
    for (const size of sizes.length ? sizes : [null]) {
      const optionValues = [];
      if (named) optionValues.push({ optionName: 'Colour', name: c.name });
      if (size) optionValues.push({ optionName: 'Size', name: size });
      if (!optionValues.length) optionValues.push({ optionName: 'Title', name: 'Default Title' });
      const qty = Number(p.stock?.[`${c.name || ''}|${size || ''}`]) || 0;
      variants.push({
        optionValues,
        price: Number(p.price),
        ...(Number(p.compareAtPrice) > 0 ? { compareAtPrice: Number(p.compareAtPrice) } : {}),
        inventoryItem: { tracked: true },
        inventoryQuantities: [{ locationId: loc, name: 'available', quantity: qty }],
        ...(c.images[0] ? { file: fileInput(c.images[0]) } : {}),
      });
    }
  }

  const input = {
    title: p.title.trim(),
    vendor: p.vendor || undefined,
    productType: p.productType || undefined,
    descriptionHtml: p.descriptionHtml || '',
    tags: p.tags || [],
    status: p.status === 'ACTIVE' ? 'ACTIVE' : 'DRAFT',
    productOptions,
    files,
    variants,
  };
  const data = await gql(env, `
    mutation($input: ProductSetInput!) {
      productSet(synchronous: true, input: $input) {
        product { id title }
        userErrors { field message }
      }
    }`, { input });
  const { product, userErrors } = data.productSet;
  if (userErrors.length) throw new Error(userErrors.map((e) => `${(e.field || []).join('.')}: ${e.message}`).join('; '));

  // The product is already in Shopify; collection and sales-channel problems only become warnings
  const warnings = [];
  let collection = null;
  try { collection = await ensureCollection(env, product.id, input.productType); }
  catch (err) { warnings.push(`Couldn't add it to a collection: ${err.message}`); }
  try { await publishToOnlineStore(env, product.id); }
  catch (err) { warnings.push(`Not added to the Online Store channel: ${err.message}`); }
  return { id: product.id, url: adminUrl(env, product.id), collection, warnings };
}

// Every category gets a collection. A new one is a smart collection on product type,
// so later uploads in the same category join it automatically.
async function ensureCollection(env, productId, title) {
  if (!title?.trim()) return null;
  title = title.trim();
  const data = await gql(env, `query($q: String!) { collections(first: 10, query: $q) { nodes { id title ruleSet { appliedDisjunctively } } } }`,
    { q: `title:"${title.replace(/["\\]/g, '')}"` });
  const existing = data.collections.nodes.find((c) => c.title.toLowerCase() === title.toLowerCase());
  if (existing) {
    // Smart collections pick products up by their rules; manual ones need the product added
    if (!existing.ruleSet) {
      const r = await gql(env, `mutation($id: ID!, $ids: [ID!]!) { collectionAddProducts(id: $id, productIds: $ids) { userErrors { message } } }`,
        { id: existing.id, ids: [productId] });
      const errs = r.collectionAddProducts.userErrors;
      if (errs.length) throw new Error(errs.map((e) => e.message).join('; '));
    }
    return { title: existing.title, created: false };
  }
  const r = await gql(env, `
    mutation($input: CollectionInput!) {
      collectionCreate(input: $input) { collection { id title } userErrors { message } }
    }`, { input: { title, ruleSet: { appliedDisjunctively: false, rules: [{ column: 'TYPE', relation: 'EQUALS', condition: title }] } } });
  const { collection, userErrors } = r.collectionCreate;
  if (userErrors.length) throw new Error(userErrors.map((e) => e.message).join('; '));
  await publishToOnlineStore(env, collection.id).catch(() => {});
  return { title: collection.title, created: true };
}

let onlineStoreCache;
async function publishToOnlineStore(env, id) {
  if (!onlineStoreCache) {
    const data = await gql(env, `{ publications(first: 20) { nodes { id name } } }`);
    onlineStoreCache = data.publications.nodes.find((p) => /online store/i.test(p.name))?.id;
    if (!onlineStoreCache) throw new Error('no Online Store channel found');
  }
  const r = await gql(env, `mutation($id: ID!, $pub: ID!) { publishablePublish(id: $id, input: [{ publicationId: $pub }]) { userErrors { message } } }`,
    { id, pub: onlineStoreCache });
  const errs = r.publishablePublish.userErrors;
  if (errs.length) throw new Error(errs.map((e) => e.message).join('; '));
}
