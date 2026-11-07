// The connection limiter, and the config it has to agree with.
//
// Every test here is about a failure mode rather than a happy path, because the happy path is
// one boolean. Two of them matter more than the rest:
//
// Failing OPEN is the whole safety property. Cloudflare's docs state no plan gate for the Rate
// Limiting binding, but no primary source confirms it is available on the free plan — so if
// the guess is wrong, `env.CONNECT_LIMIT` is simply `undefined` at runtime. That has to mean
// "behave exactly as this relay did before the limiter existed", not "refuse everyone". A
// regression there would take the whole demo down rather than degrade it.
//
// Keying on the IP and never the room is the other one. Keyed on the room, one flooder would
// lock legitimate visitors out of a real demo workspace — the limiter would become the denial
// of service it exists to bound. That is asserted negatively, not left to a comment.

import { describe, expect, it } from 'vitest';
import {
	CONNECT_LIMIT,
	MAX_UPGRADE_URL_LENGTH,
	addressKey,
	connectKey,
	refuseConnect,
	screenUpgrade
} from './limits.js';

/** Enough of `RateLimit` to drive `refuseConnect`, with no network and no workerd. */
const limiter = (outcome: boolean | 'throws'): RateLimit =>
	({
		limit: async () => {
			if (outcome === 'throws') throw new Error('binding unavailable');
			return { success: outcome };
		}
	}) as unknown as RateLimit;

const withHeaders = (headers: Record<string, string>) => ({ headers: new Headers(headers) });

describe('refuseConnect', () => {
	it('fails open when the binding is not bound at all', async () => {
		// The free-plan availability of `ratelimits` is unverified, so this is the case that
		// decides whether a wrong guess degrades or breaks.
		await expect(refuseConnect(undefined, '203.0.113.1')).resolves.toBeUndefined();
	});

	it('fails open when there is no caller identity to key on', async () => {
		// Unreachable in production — the edge always sets cf-connecting-ip and a client cannot
		// strip it — and the only sane behaviour everywhere else.
		await expect(refuseConnect(limiter(false), null)).resolves.toBeUndefined();
	});

	it('fails open when the binding throws', async () => {
		await expect(refuseConnect(limiter('throws'), '203.0.113.1')).resolves.toBeUndefined();
	});

	it('lets a connection through while the client is under the limit', async () => {
		await expect(refuseConnect(limiter(true), '203.0.113.1')).resolves.toBeUndefined();
	});

	it('refuses with a 429 and a retry-after once the client is over it', async () => {
		const response = await refuseConnect(limiter(false), '203.0.113.1');
		expect(response?.status).toBe(429);
		// The browser sees a refused upgrade as a connection close, so without a status and a
		// retry hint the refusal is invisible to the client's circuit breaker.
		expect(response?.headers.get('retry-after')).toBe(String(CONNECT_LIMIT.period));
	});
});

describe('connectKey', () => {
	it('keys on the calling IP', () => {
		expect(connectKey(withHeaders({ 'cf-connecting-ip': '203.0.113.7' }))).toBe('203.0.113.7');
	});

	it('has no key when Cloudflare did not supply an IP', () => {
		// Deliberately not a shared `'unknown'` bucket. That is a global limit on every caller
		// at once, and it is reached precisely where the edge is absent — `wrangler dev`, CI,
		// a local Playwright run — so it took the e2e suite down rather than any attacker.
		expect(connectKey(withHeaders({}))).toBeNull();
	});

	it('never keys on the room, which would let one flooder lock a real workspace out', () => {
		const room = 'w0123456789abcdef0123456789abcdef';
		const key = connectKey(
			withHeaders({ 'cf-connecting-ip': '203.0.113.7', 'x-partykit-room': room })
		);
		expect(key).not.toBe(room);
		expect(key).not.toContain(room);
	});
});

describe('CONNECT_LIMIT', () => {
	// Coherence with wrangler.jsonc is asserted in `wrangler-coherence.test.ts`, not here. The
	// reason it is a separate file is worth knowing before moving it back: reading the config
	// looked like it needed `node:fs`, and Node's types cannot be added to this package without
	// colliding with workerd's (they disagree about URLSearchParams, among others). Vite's
	// `?raw` import gets the file as text with no Node types at all, which is why the check
	// exists rather than being left to a human reading the dry-run's output.
	//
	// What is still worth asserting here is the one value the binding silently rejects.
	it('uses a period the binding actually accepts', () => {
		// The API takes 10 or 60 and nothing else; anything else fails at deploy.
		expect([10, 60]).toContain(CONNECT_LIMIT.period);
	});

	it('stays loose enough that a cooperating client cannot trip it', () => {
		// provider.ts caps backoff at 30 s (<=2 attempts/min) and trips a circuit breaker at
		// 8 closes in 20 s, so a real client's worst case is far under this.
		expect(CONNECT_LIMIT.limit).toBeGreaterThanOrEqual(10);
	});
});

describe('addressKey', () => {
	it('keys an IPv6 client on its /64, which one host is routinely given whole', () => {
		expect(addressKey('2001:db8:1:2:aaaa:bbbb:cccc:dddd')).toBe('2001:db8:1:2::/64');
		expect(addressKey('2001:db8:1:2::1')).toBe(addressKey('2001:db8:1:2:ffff::9'));
		expect(addressKey('2001:DB8:0001:0002::1')).toBe('2001:db8:1:2::/64');
		expect(addressKey('2001:db8::1')).toBe('2001:db8:0:0::/64');
		expect(addressKey('2001:db8:1:3::1')).not.toBe(addressKey('2001:db8:1:2::1'));
	});

	it('leaves IPv4 alone, including when it is written as IPv6', () => {
		expect(addressKey('203.0.113.7')).toBe('203.0.113.7');
		expect(addressKey('::ffff:203.0.113.7')).toBe('203.0.113.7');
	});

	it('is what connectKey uses', () => {
		expect(connectKey(withHeaders({ 'cf-connecting-ip': '2001:db8:1:2::5' }))).toBe(
			'2001:db8:1:2::/64'
		);
	});
});

describe('screenUpgrade', () => {
	const origins = 'https://syncticket.elbaymalik.com,http://localhost:4173';
	const upgrade = (url: string, headers: Record<string, string> = {}) =>
		new Request(url, { headers: { upgrade: 'websocket', ...headers } });
	const room = 'https://relay.test/parties/y-doc-room/w' + '0'.repeat(32);

	it('lets the app’s own pages through, and callers that send no Origin', () => {
		for (const headers of [{ origin: 'https://syncticket.elbaymalik.com' }, {}] as Record<
			string,
			string
		>[]) {
			expect(screenUpgrade(upgrade(`${room}?_pk=Ab3_-xYz12`, headers), origins)).toBeInstanceOf(
				Request
			);
		}
	});

	it('refuses a page on another site, and an opaque origin', async () => {
		for (const origin of [
			'https://evil.example',
			'null',
			'https://syncticket.elbaymalik.com.evil'
		]) {
			const result = screenUpgrade(upgrade(room, { origin }), origins);
			expect(result).toBeInstanceOf(Response);
			expect((result as Response).status).toBe(403);
		}
	});

	it('allows every origin when none is configured, rather than refusing everyone', () => {
		expect(
			screenUpgrade(upgrade(room, { origin: 'https://evil.example' }), undefined)
		).toBeInstanceOf(Request);
	});

	it('refuses a connection id or a URL the client would never send', () => {
		const badId = screenUpgrade(upgrade(`${room}?_pk=${'a'.repeat(300)}`), origins) as Response;
		expect(badId.status).toBe(400);
		const long = screenUpgrade(
			upgrade(`${room}?x=${'a'.repeat(MAX_UPGRADE_URL_LENGTH)}`),
			origins
		) as Response;
		expect(long.status).toBe(414);
	});

	it('strips props only the worker may set', () => {
		const result = screenUpgrade(upgrade(room, { 'x-partykit-props': '{"a":1}' }), origins);
		expect(result).toBeInstanceOf(Request);
		expect((result as Request).headers.has('x-partykit-props')).toBe(false);
		expect((result as Request).headers.get('upgrade')).toBe('websocket');
	});
});
