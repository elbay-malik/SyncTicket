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
//   - It does not limit messages on an established socket. That is `message-limits.ts`, in
//     memory: hibernation does evict its counters, but only once the socket has gone quiet, and
//     that quiet is itself a pause the sender had to take.

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
	const ip = request.headers.get('cf-connecting-ip');
	return ip === null ? null : addressKey(ip);
}

/**
 * The part of an address that identifies one client: all of an IPv4 address, and the /64
 * network of an IPv6 one. A single host is routinely given a whole /64, so keying on the full
 * IPv6 address handed one machine billions of separate buckets.
 */
export function addressKey(ip: string): string {
	if (!ip.includes(':')) return ip;
	// An IPv4 address written as IPv6 (::ffff:203.0.113.1) is the IPv4 address.
	const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
	if (mapped) return mapped[1]!;
	const [head = '', tail = ''] = ip.toLowerCase().split('::');
	const front = head ? head.split(':') : [];
	const back = tail ? tail.split(':') : [];
	const groups = ip.includes('::')
		? [...front, ...Array<string>(Math.max(0, 8 - front.length - back.length)).fill('0'), ...back]
		: front;
	const network = groups.slice(0, 4).map((group) => group.replace(/^0+(?=.)/, '') || '0');
	return `${network.join(':')}::/64`;
}

/** Where the app is served from, as `ALLOWED_ORIGINS` lists it: comma-separated origins. */
export function allowedOrigins(value: string | undefined): Set<string> | null {
	if (!value) return null;
	return new Set(
		value
			.split(',')
			.map((origin) => origin.trim())
			.filter(Boolean)
	);
}

/** The longest upgrade URL the app's client sends is well under this. */
export const MAX_UPGRADE_URL_LENGTH = 2048;
/** partyserver takes `_pk` as the connection id; the client sends `nanoid(10)`. */
const CONNECTION_ID = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Checks the parts of an upgrade request that are not the room name, and strips what only a
 * server should send. A Response refuses the connection; a Request replaces the incoming one.
 *
 * - **Origin.** A browser always says which page opened a socket, and a page on another site
 *   has no business opening one here: that is how a script on any site with visitors could open
 *   rooms from each visitor's browser, each with a limiter bucket of its own. A request with no
 *   Origin at all is not a browser's, so a page cannot send one; it is let through, and the
 *   limiter is what bounds it. `"null"` (a sandboxed frame or a file) is refused. With no list
 *   configured, every origin is allowed, so a misconfigured deploy degrades instead of refusing
 *   everyone.
 * - **Shape.** partyserver stores the whole URL with each socket and uses `_pk` as the
 *   connection id and a hibernation tag; a value the client would never send makes setup throw,
 *   and partyserver answers that with its stack trace.
 * - **Props.** `x-partykit-props` is meant to come from the worker, never from the client.
 */
export function screenUpgrade(request: Request, origins: string | undefined): Response | Request {
	const allowed = allowedOrigins(origins);
	const origin = request.headers.get('origin');
	if (allowed && origin !== null && !allowed.has(origin)) {
		return new Response('origin not allowed', { status: 403 });
	}
	if (request.url.length > MAX_UPGRADE_URL_LENGTH) {
		return new Response('request too long', { status: 414 });
	}
	const id = new URL(request.url).searchParams.get('_pk');
	if (id !== null && !CONNECTION_ID.test(id)) {
		return new Response('bad connection id', { status: 400 });
	}
	if (!request.headers.has('x-partykit-props')) return request;
	const headers = new Headers(request.headers);
	headers.delete('x-partykit-props');
	return new Request(request, { headers });
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
