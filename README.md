# TruckerFetch MCP

Connect assistants to published U.S. motor carrier research. Choose the hosted OAuth server or this local stdio bridge. Both use the same TruckerFetch account permissions and require active Pro access.

- Documentation: https://truckerfetch.com/docs
- REST contract: https://truckerfetch.com/api/v1/openapi.json
- API examples: https://github.com/truckerfetch/truckerfetch-api-examples
- Workflow skills: https://github.com/truckerfetch/truckerfetch-agent-skills

## Hosted connection

Remote endpoint: **`https://truckerfetch.com/api/mcp`** (Streamable HTTP).

Use your client's OAuth connection flow with no client secret and the registered client ID:

| Client | Registered client ID | Acceptance status |
| --- | --- | --- |
| ChatGPT | `truckerfetch-chatgpt` | OAuth, refresh and authority research verified in the native host |
| Claude | `truckerfetch-claude` | Registered; native end-to-end acceptance remains unverified |
| Cursor | `truckerfetch-cursor` | Registered; native end-to-end acceptance remains unverified |

The statuses describe the application's recorded acceptance, not a marketplace listing or a guarantee for every client version. See [config/hosted-cursor.json](config/hosted-cursor.json) for the registered Cursor configuration. Clients must support static OAuth client IDs; there is no advertised dynamic registration endpoint.

Start with `data:read`. Discovery is at `https://truckerfetch.com/.well-known/oauth-protected-resource/api/mcp` and `https://truckerfetch.com/.well-known/oauth-authorization-server`. The server uses authorization code + S256 PKCE, resource binding and rotating refresh tokens. Exact registered callbacks are required. Review/revoke grants in [Connected apps](https://truckerfetch.com/dashboard/api/connections).

Do not paste REST keys or OAuth tokens into chat prompts. Hosted MCP uses its own OAuth grant; a REST `tf_` key does not authenticate the hosted endpoint.

## Local stdio bridge

Requires Node.js 24+. This repository is source-distributed; no npm publication is claimed.

```bash
git clone https://github.com/truckerfetch/truckerfetch-mcp.git
cd truckerfetch-mcp
npm ci --ignore-scripts
# Load TRUCKERFETCH_API_KEY securely into the process environment.
npm start
```

Create a narrowly scoped REST key at [API keys](https://truckerfetch.com/dashboard/api/keys). The bridge uses `TRUCKERFETCH_API_KEY` (`tf_…`) to call REST at `https://truckerfetch.com/api/v1`. It does not perform hosted MCP OAuth. See [config/stdio.json](config/stdio.json); substitute an absolute checkout path and configure the secret in your client's secure environment. Never commit a real key in client JSON.

Standard output belongs exclusively to the MCP protocol. Run the bridge from an MCP host, or use `npm test` to exercise it with the SDK. Network requests use a 30-second deadline, reject redirects and restrict destinations to the official HTTPS origins. Loopback HTTP is available only through an explicit `TRUCKERFETCH_ALLOW_LOCAL_TEST=1` opt-in for local fixtures; leave this unset in normal use.

## Tools and permissions

The 22 tools and their input schemas are in [tools.json](tools.json), generated from the application's registry. Operations cover edition/catalog research, carrier profiles, authority and insurance observations, evidence, changes, owned watchlists, export jobs and deliberate archive unlocks. Reference resources expose field definitions and filter schemas.

| Workflow | Permissions |
| --- | --- |
| Published carrier/edition/evidence research | `data:read` |
| Reported contact fields | Add `contacts:read` |
| Insurance observations and renewal research | `insurance:read`, plus `data:read` for a carrier's filings; capability must be available |
| Owned watchlists | `watchlists:read` or `watchlists:write` as applicable |
| Export creation | `exports:write` + `contacts:read`; insurance scope for renewal selection |
| Export status | `exports:read`; insurance scope for renewal exports |
| Historical unlock | `data:read` + `archive:unlock` |

Scopes supplement subscription, ownership and data availability checks. Do not request all scopes by default. Insurance date bases are distinct; an estimated anniversary does not prove policy expiration.

Begin with a bounded read:

```json
{
  "name": "search_carriers",
  "arguments": { "filters": { "states": ["TX"] }, "limit": 10 }
}
```

Return data and source dates together. USDOT identifiers remain strings. Start with 10 rows for assistant calls; larger pages can exceed the bounded model response limit. The local bridge and hosted server do not place CSV bytes in tool results; use an authenticated application/download workflow outside model context.

## Mutations and confirmation

The local bridge adds **`confirm_action: true`** to seven mutation tool schemas: create/add/remove/update watchlist operations, `request_export` and `unlock_edition`. Set it only after the user approves the exact target/selection. It is a local safety field and is removed before REST dispatch.

Exports through this bridge use **REST semantics**: once the exact selection is approved and the saved idempotency key supplied, the server may enqueue the job without a second browser approval. Hosted MCP exports require the separate signed-in TruckerFetch approval flow. Both surfaces require the browser approval flow for historical unlocks. On `confirmation_required`, review the returned trusted TruckerFetch URL and repeat the exact request with the **same** key after approval.

Use a saved 8–128-character `idempotency_key` for mutations whose schema requires one. Do not generate a different key after a timeout or retry with changed selection. The bridge performs no automatic mutation retries. Handle `429` using the returned retry interval and shared account request budget. Additional keys/grants do not create additional account allowance.

The latest edition may be `null` before publication. Listing metadata does not spend an archive unlock; both edition metadata tools can catch up already-due publications and their normal notifications, so their annotations do not claim strict read-only behavior. Expired historical dates return `archive_expired`; a saved grant does not override the rolling 90 Eastern-date window.

## Development

```bash
npm ci --ignore-scripts
npm test
# Maintainers with the application checkout:
TRUCKERFETCH_SOURCE=/absolute/path/to/truckerfetch-com npm run manifest:check
TRUCKERFETCH_SOURCE=/absolute/path/to/truckerfetch-com npm run manifest:generate
```

The exporter reads the single application registry and produces `tools.json`, `operations.json`, `resources.json` and public source hashes in `manifest-source.json`. It copies contract metadata only. Review the diff and rerun tests whenever the application registry changes. Public CI validates the snapshot and exercises actual stdio SDK traffic with a loopback fixture; it does not require access to private server source or real credentials.

The SDK is pinned to `1.32.2` and dependencies are locked. Tests cover schema/operation consistency, wire initialization and tool execution, denied mutations, redirect/origin restrictions, bounded payloads, trusted approval links and sanitized failures. No live carrier requests are made by tests.

## License

MIT applies to the client code in this repository. It does not license TruckerFetch customer data, trademarks or the hosted service. See [SECURITY.md](SECURITY.md) for reporting issues.
