// How often one client may ask this relay to open a socket.
//
// Pure and dependency-free on purpose, like `rooms.ts` and `storage.ts`: the worker entry
// imports `cloudflare:`-scheme modules that a Node test runner cannot load, so anything that
// needs testing has to live outside it.
//
// WHY THIS EXISTS AT ALL, since the honest answer is narrower than "rate limiting":
// `rooms.ts` refuses a name that is not the shape the app mints, but that is a *shape* check
// with no secret in it — a stranger can mint `a` plus 32 random hex characters as cheaply as
// the app can. So creating empty rooms is open, and creating one is not free: partyserver
// writes the room name on first initialisation (`dist/index.js`, `__ps_name` via
// `ctx.storage.put`) and `onLoad` creates the snapshot table. Each fabricated room therefore
// spends the free plan's 100,000 rows-written-per-day budget and leaves SQLite storage that,
// unlike the daily counters, does not reset at 00:00 UTC.
//
// That write budget is the one worth defending, because exhausting it does not cause an
// outage — it makes `onSave` throw, and y-partyserver swallows that into a `console.error`
// (`dist/server/index.js`). Real workspaces go on relaying in memory while silently no longer
// persisting.
//
// WHAT THIS DOES NOT DO, and must never be described as doing:
//   - It does not delay the demo going offline. A Worker request is billed when it *arrives*,
//     before `onBeforeConnect` runs, so refusing an upgrade saves the Durable Object request
//     and not the Worker one. Both budgets are 100,000/day, so time-to-Error-1027 is
//     unchanged by this code.
//   - It does not close room creation. It narrows the rate from one source; a distributed
//     source walks straight past a per-location counter. Closing it needs a signed id, which
//     would change the id format, the IndexedDB database name and every existing demo URL.
//   - It does not limit messages on an established socket. Deliberate: `hibernate: true`
//     evicts any in-memory counter at a moment an attacker picks, and a storage-backed one
//     would spend more of the write budget than the messages it polices — an inbound
//     WebSocket message bills at 1/20th of a request, while one counter row costs a whole
//     row write, competing directly with the snapshot writes that are the actual data path.

/**
 * The limit this relay asks Cloudflare to enforce. `wrangler.jsonc` carries the copy that
 * Cloudflare actually reads, so this constant is documentation of it rather than its source;
 * `wrangler-coherence.test.ts` asserts the two agree, which is what makes drift fail the suite
 * instead of being noticed in a deploy's output or not at all.
 *
 * `period` may only be 10 or 60; the Rate Limiting binding accepts nothing else.
 *
 * 30/60s is deliberately loose. A cooperating client is nowhere near it — one socket per tab,
 * backoff capped at 30 s and a circuit breaker that trips at 8 closes in 20 s
 * (`src/lib/sync/provider.ts`) — and the marginal protection between 20 and 30 is nil for a
 * path already bounded by the request budget, while a false positive behind one office or
 * conference NAT would break the demo for a real visitor.
 */
export const CONNECT_LIMIT = { limit: 30, period: 60 } as const;

/**
 * Keyed on the client IP, never on the room name, and `null` when there is no IP to key on.
 *
 * Keying on the room would let one flooder lock legitimate visitors out of a real demo
 * workspace — the limiter would become the denial of service. `limits.test.ts` asserts this
 * negatively rather than trusting the comment.
 *
 * `null` rather than a shared `'unknown'` bucket, which is how this was first written and was
 * wrong in a way only the e2e suite caught: `cf-connecting-ip` is set by Cloudflare's edge, so
 * it is absent exactly when the relay is NOT behind the edge — `wrangler dev`, CI, a local
 * Playwright run. A shared bucket there is a global 30/60s limit on every caller at once, and
 * 46 e2e tests drained it until the suite's last reconnect was refused.
 *
 * Not a bypass in production: the edge sets this header on every request and a client cannot
 * remove it, so the `null` path is unreachable on a real deploy. Where it IS reachable,
 * limiting is pointless — there is one caller and it is you.
 */
export function connectKey(request: Pick<Request, 'headers'>): string | null {
	return request.headers.get('cf-connecting-ip');
}

/**
 * A 429 when this client has asked too often, `undefined` to let the connection through.
 *
 * Returned straight from `onBeforeConnect`, which partyserver awaits *before* it fetches the
 * Durable Object stub — so a refusal here creates no object, the same guarantee the room-name
 * check has.
 *
 * Fails OPEN on every uncertainty: an unbound binding, a throwing one, and a request with no
 * `cf-connecting-ip` to key on all resolve `undefined`. That was written when it was unknown
 * whether the binding works on the free plan at all — if it silently did nothing, failing open
 * is the only degradation that does not take the demo down with it.
 *
 * It does work, measured against the deploy on 2026-10-22: 60 concurrent upgrade attempts from
 * one address got 42 × 101 and 18 × 429, and `wrangler tail` logged no `limiter unavailable`
 * across the burst. The fail-open paths stay exactly as they are — they cover a broken binding
 * and a missing client IP, neither of which this measurement rules out.
 *
 * Counters are per Cloudflare location and the API is documented as permissive and eventually
 * consistent — "intentionally designed to not be used as an accurate accounting system". This
 * turns a flood into a trickle. It guarantees nothing, and the measurement above shows the gap
 * is real rather than theoretical: a nominal 30/60s let 42 through when asked 60 times at once.
 * Treat the limit as an order of magnitude, never as a count.
 */
export async function refuseConnect(
	limiter: RateLimit | undefined,
	key: string | null
): Promise<Response | undefined> {
	// No binding, or no caller identity to key on: both are "we cannot limit this", and the
	// answer to that is always to let it through. See `connectKey` for why a missing key means
	// the request did not come through Cloudflare's edge at all.
	if (!limiter || key === null) return undefined;
	try {
		const { success } = await limiter.limit({ key });
		if (success) return undefined;
	} catch (error) {
		// Fail open: a limiter that is broken must not be able to take the demo down.
		console.error('relay connect limiter unavailable', error);
		return undefined;
	}
	// `retry-after` because a 429 reaches the browser as a connection close and feeds the
	// client's existing circuit breaker; without a status the refusal would be invisible.
	return new Response('too many connection attempts', {
		status: 429,
		headers: { 'retry-after': String(CONNECT_LIMIT.period) }
	});
}
