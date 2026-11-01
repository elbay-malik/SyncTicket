// The shell is rendered by the Worker, so the boundary has to survive svelte/server as well. The
// three views sit behind `store.synced` and never get this far today (e2e/duplicate-labels.e2e.ts
// has the real routes), which is exactly why nothing else would notice if this broke.

import { createRawSnippet } from 'svelte';
import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import ViewBoundary from './view-boundary.svelte';

const title = 'The list couldn’t be shown';

describe('view-boundary.svelte on the server', () => {
	it('renders its children and nothing of the fallback', () => {
		const children = createRawSnippet(() => ({ render: () => '<p>The list</p>' }));

		const { body } = render(ViewBoundary, { props: { title, children } });

		expect(body).toContain('<p>The list</p>');
		expect(body).not.toContain(title);
	});

	it('passes a throw on, because without handleRenderingErrors nothing transforms it', () => {
		const children = createRawSnippet(() => ({
			render: () => {
				throw new Error('a bad record');
			}
		}));

		// `body` is a getter: render() is lazy, and reading it is what runs the component.
		expect(() => render(ViewBoundary, { props: { title, children } }).body).toThrow('a bad record');
	});
});
