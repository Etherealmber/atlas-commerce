# Enterprise patterns → Cloudflare edge (Atlas)

| Classic | Atlas equivalent | Status |
|---------|------------------|--------|
| Redis | **KV** (`CACHE`) + isolate memory | In use |
| Nginx reverse proxy | **Cloudflare edge** (TLS, routing, WAF) | Platform |
| gRPC microservices | **JSON/HTTP** Hono routes + `/api/v1` | Partner v1 |
| Multi-BFF apps | **One Worker**, surfaces via `worker/lib/bff.ts` + `/api/v1` + `/m` | Done |
| Circuit breaker mesh | `worker/lib/circuit-breaker.ts` + `upstreamFetch` | Done |
| SQS / Bull queues | `worker/lib/job-queue.ts` (`waitUntil` + KV dedupe) | Done |
| NestJS monolith | Hono modules under `worker/routes/*` | Ongoing peel |

Do **not** add Redis/Nginx/gRPC unless leaving the Workers platform.
