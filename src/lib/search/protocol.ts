// Message types shared by the main thread and the search worker. Pure types only — this
// module is imported from both sides, so it must pull in nothing.

/**
 * The shape the worker indexes.
 *
 * `text` is the title and description concatenated, and the duplication is deliberate.
 * FlexSearch requires every term of a multi-word query to appear in the *same* field, so
 * indexing title and description separately makes "palette focus" find nothing when the two
 * words live in different fields — worse than the substring filter it replaces. Indexing
 * `title` as well keeps title matches ranked first.
 *
 * Declared as a type alias rather than an interface on purpose: FlexSearch constrains its
 * document generic to an index signature, and TypeScript gives those to aliases but not to
 * interfaces, so `Document<SearchDoc>` fails to compile if this becomes an interface.
 */
export type SearchDoc = {
	id: string;
	title: string;
	text: string;
};

/** How a set of results was produced, for the UI to report honestly. */
export type SearchMode = 'lexical' | 'hybrid';

export type SemanticStatus = 'off' | 'loading' | 'ready' | 'failed';

/** Main thread → worker. */
export type ToWorker =
	| { kind: 'sync'; docs: SearchDoc[] }
	| { kind: 'upsert'; docs: SearchDoc[] }
	| { kind: 'remove'; ids: string[] }
	| { kind: 'query'; id: number; text: string; limit: number }
	| { kind: 'warm' };

/** Worker → main thread. */
export type FromWorker =
	| { kind: 'results'; id: number; ids: string[]; mode: SearchMode }
	| { kind: 'status'; semantic: SemanticStatus; progress?: number };

/** Builds the indexed shape from an issue-like value. */
export function toSearchDoc(issue: { id: string; title: string; description: string }): SearchDoc {
	return {
		id: issue.id,
		title: issue.title,
		text: `${issue.title}\n${issue.description}`
	};
}
