// The Yjs document is the single source of truth for a workspace. A workspace doc holds
// one top-level Y.Map ("issues") whose values are per-issue Y.Maps of scalar fields.

import * as Y from 'yjs';

export const ISSUES_KEY = 'issues';

/** A single issue's CRDT representation: a Y.Map of scalar fields keyed by field name. */
export type YIssue = Y.Map<unknown>;

export function createDoc(): Y.Doc {
	return new Y.Doc();
}

export function getIssuesMap(doc: Y.Doc): Y.Map<YIssue> {
	return doc.getMap<YIssue>(ISSUES_KEY);
}
