// Which room names this relay will create a Durable Object for.
//
// This matters more than a regex test usually would. `routePartykitRequest` hands any name
// it is given straight to `doNamespace.get(id).fetch()` (partyserver `dist/index.js:538`),
// and that call is what brings a Durable Object — with its own SQLite storage — into
// existence. Not only over WebSocket: `Server.fetch` awaits `#ensureInitialized()` before
// it decides a request is not an upgrade, so a plain GET created a room as a side effect of
// answering 404. Until `onBeforeConnect`/`onBeforeRequest` were wired up, one unauthenticated
// curl per name could create unbounded rooms on a public deploy.
//
// The guard is only as good as this pattern matching what the client actually mints, which
// is a deliberate coupling across the two workers — the same kind as the party name.

import { describe, expect, it } from 'vitest';
import { isRoutableRoom } from './rooms.js';

/** Mirrors `createWorkspaceId()` in src/lib/model/workspace.ts. */
const mintedByTheApp = () => `w${crypto.randomUUID().replace(/-/g, '')}`;
/** Mirrors the `room()` helper the e2e fixtures use. */
const mintedByTheTests = () => `t${crypto.randomUUID().replace(/-/g, '')}`;

describe('isRoutableRoom', () => {
	it('accepts the ids the app and the e2e fixtures actually mint', () => {
		for (let i = 0; i < 50; i += 1) {
			expect(isRoutableRoom(mintedByTheApp())).toBe(true);
			expect(isRoutableRoom(mintedByTheTests())).toBe(true);
		}
	});

	it('refuses everything a stranger could type', () => {
		const hostile = [
			'evil-room-1',
			'a',
			'',
			'../../etc/passwd',
			'/foo',
			'A'.repeat(300),
			'w'.repeat(33),
			// The guessable id an old client could still be carrying, and the one name an
			// attacker would try first.
			'default',
			// Right shape, wrong alphabet — hex only, so this is not a routable id.
			`w${'z'.repeat(32)}`,
			// Right alphabet, wrong length.
			`w${'a'.repeat(31)}`,
			`w${'a'.repeat(33)}`,
			// Upper-case hex is not what the client mints, so it is not accepted either.
			`W${'A'.repeat(32)}`
		];
		for (const name of hostile) {
			expect(isRoutableRoom(name), `should refuse ${JSON.stringify(name)}`).toBe(false);
		}
	});

	it('is anchored, so a valid id embedded in junk does not slip through', () => {
		const valid = mintedByTheApp();
		expect(isRoutableRoom(`${valid}/../other`)).toBe(false);
		expect(isRoutableRoom(`prefix${valid}`)).toBe(false);
		expect(isRoutableRoom(`${valid}\nsecond`)).toBe(false);
	});
});
