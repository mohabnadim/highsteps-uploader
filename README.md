# High Steps Uploader

Live at https://high-steps-uploader.mohabnadim.workers.dev

Staff pick a product folder, restyle the photos onto the High Steps cream backdrop, fill in
price / sizes / stock / brand / description, and upload to Shopify as a draft or live product.

Folder layout it expects: `Category / Product / [Colour] / photos`.
Colour folders become a Colour option; sizes become a Size option.

## Restyle modes

- **Clean cutout (free, default)** — Cloudflare Images removes the background (`segment: "foreground"`),
  then the page places the product on the cream backdrop with a soft shadow. The product itself is never repainted.
  `public/studio.js` builds the studio look: a lit backdrop sweep (Bone, Studio cream, Paper, Stone or Pure white,
  picked next to "Restyle all"), a floor shadow that follows the product's shape, and mild auto tone.
  **Adjust** on any restyled photo opens an editor for size, position, shadow, exposure, warmth, contrast,
  saturation and edge clean-up, with a hold-to-compare button and "Look → all photos" for the whole product.
- **AI reshoot (Gemini)** — only shows when `GEMINI_API_KEY` is set. Needs billing enabled on the
  Google AI Studio project; the free tier allows 0 image generations.

## Secrets

Set with `npx wrangler secret put NAME` from this folder:
`STAFF_PASSWORD`, `SHOPIFY_CLIENT_ID`, `SHOPIFY_CLIENT_SECRET` (Dev Dashboard app with
`write_products, read_products, write_inventory, read_inventory, read_locations, write_files`),
and optionally `GEMINI_API_KEY`.

## Deploy / test

```
npm install
npx wrangler deploy
npx wrangler dev --remote   # background removal only works against Cloudflare, not fully local
```
