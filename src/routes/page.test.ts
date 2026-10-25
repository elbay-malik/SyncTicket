import { isRedirect } from '@sveltejs/kit';
import { describe, expect, it } from 'vitest';
import { load } from './+page.js';

/** Runs the root load and returns where it redirected to. */
function redirectFor(href: string): string {
	try {
		// Only `url` is read; the rest of the load event is irrelevant to a redirect.
		load({ url: new URL(href, 'https://example.test') } as Parameters<typeof load>[0]);
	} catch (thrown) {
		if (isRedirect(thrown)) return thrown.location;
		throw thrown;
	}
	throw new Error('the root route did not redirect');
}

describe('the root redirect', () => {
	it('sends a bare visit to the issue list', () => {
		expect(redirectFor('/')).toBe('/issues');
	});

	it('keeps the workspace link it was given', () => {
		// A share link trimmed to the origin plus `?ws=` must still be a share link; dropping the
		// query here once landed its recipient in an unrelated, empty workspace.
		expect(redirectFor('/?ws=w00000000000000000000000000000001')).toBe(
			'/issues?ws=w00000000000000000000000000000001'
		);
	});
});
