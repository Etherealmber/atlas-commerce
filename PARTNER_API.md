# Partner API v1 — keys & smoke

## Expected without a key
`GET /api/v1/health` → **401** + `{ success: false, code: "UNAUTHORIZED" }`  
Smoke treats that as **OK**.

## Make authenticated smoke pass

1. Create a secret (once):
   ```bash
   npx wrangler secret put PARTNER_API_KEY
   # paste a long random value, e.g. output of: openssl rand -hex 32
   ```

2. Run smoke with the **same** value:
   ```bash
   set ATLAS_SMOKE_BASE=https://stock.afmarbre.com
   set ATLAS_PARTNER_KEY=paste-same-secret-here
   npm run smoke
   ```
   Or:
   ```bash
   ATLAS_PARTNER_KEY=... ATLAS_SMOKE_BASE=https://stock.afmarbre.com npm run smoke:partner
   ```

3. Call the API:
   ```http
   GET /api/v1/health
   X-Api-Key: <your PARTNER_API_KEY>
   ```

Optional: store hashed keys in D1 `partner_api_keys` (see `worker/routes/partner-v1.ts`).
