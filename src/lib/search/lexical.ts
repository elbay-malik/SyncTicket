// The FlexSearch index, behind a typed door.
//
// FlexSearch is fast — a single-letter prefix over 10,000 issues costs about 5 µs, against
// roughly 4 ms for a scoring engine that ranks every match — because it stops as soon as it
// has enough results. Its API is the price: heavily generic types over a minified bundle,
// per-field limits, and ids typed as string-or-number. All of that stops here; the rest of
// the codebase sees ids and strings.

import { Document } from 'flexsearch';
import type { SearchDoc } from './protocol.js';

export class LexicalIndex {
	#index: Document<SearchDoc>;

	constructor() {
		this.#index = new Document<SearchDoc>({
			document: { id: 'id', index: ['title', 'text'] },
			// Prefix matching, so results appear while the query is still being typed.
			tokenize: 'forward'
		});
	}

	add(docs: readonly SearchDoc[]): void {
		for (const doc of docs) this.#index.add(doc);
	}

	/** Add or replace. FlexSearch's `update` is a no-op for an id it has never seen. */
	upsert(docs: readonly SearchDoc[]): void {
		for (const doc of docs) {
			this.#index.remove(doc.id);
			this.#index.add(doc);
		}
	}

	remove(ids: readonly string[]): void {
		for (const id of ids) this.#index.remove(id);
	}

	/**
	 * The best `limit` ids for a query, title matches first.
	 *
	 * `merge: true` is not cosmetic: without it the result is one bucket per indexed field,
	 * and `limit` applies to each of them separately — asking for 20 would return up to 40.
	 */
	query(text: string, limit: number): string[] {
		const trimmed = text.trim();
		if (!trimmed || limit <= 0) return [];
		const merged = this.#index.search(trimmed, { limit, merge: true });
		const ids: string[] = [];
		for (const entry of merged) {
			const id = String(entry.id);
			if (!ids.includes(id)) ids.push(id);
			if (ids.length === limit) break;
		}
		return ids;
	}
}
