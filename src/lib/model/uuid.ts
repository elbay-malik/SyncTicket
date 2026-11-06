/**
 * A random v4 UUID, in the lowercase form `crypto.randomUUID()` produces.
 *
 * `crypto.randomUUID` is missing in some browsers the app otherwise runs in: WebKit before 15.4,
 * which is every browser on an older iPhone, Chrome included. Calling it there threw while the
 * root layout minted a workspace id, so hydration failed and the page went black. The fallback
 * draws on `crypto.getRandomValues`, which every supported browser has, and is just as random.
 */
export function randomUUID(): string {
	if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
	return uuidFromBytes(crypto.getRandomValues(new Uint8Array(16)));
}

/** Formats 16 random bytes as a v4 UUID. Exported for tests. */
export function uuidFromBytes(bytes: Uint8Array): string {
	bytes[6] = (bytes[6]! & 0x0f) | 0x40; // version 4
	bytes[8] = (bytes[8]! & 0x3f) | 0x80; // RFC 9562 variant
	const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
