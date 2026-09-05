// Cross-component UI state that isn't part of the workspace document: which overlays are
// open. Lives here (not in a component) so the command menu in the root layout and the
// issues route can drive the same dialog. Module-level $state is fine for this: it only
// ever changes in the browser (SSR renders it at its default), so nothing leaks between
// server requests.

export const issueUi = $state({
	/** The "New issue" dialog, mounted once in the issues layout. */
	createOpen: false
});
