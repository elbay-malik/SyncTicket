// Reactive query index over the issue store. Filter/sort/group state lives here as runes;
// the results recompute via $derived whenever the store's projection or the controls
// change. The heavy lifting is pure functions in src/lib/model/query.

import type { Issue, IssueStatus } from '$lib/model/issue.js';
import {
	countByStatus,
	filterIssues,
	groupByStatus,
	sortIssues,
	type IssueSort
} from '$lib/model/query.js';
import type { IssueStore } from './issues.svelte.js';

export class IssueQuery {
	status = $state<IssueStatus | 'all'>('all');
	text = $state('');
	sort = $state<IssueSort>('manual');

	#store: IssueStore;

	constructor(store: IssueStore) {
		this.#store = store;
	}

	get synced(): boolean {
		return this.#store.synced;
	}

	// Materialise the projection once per change; the views below all read this snapshot.
	#items: Issue[] = $derived.by(() => this.#store.all);

	results: Issue[] = $derived.by(() =>
		sortIssues(filterIssues(this.#items, { status: this.status, text: this.text }), this.sort)
	);

	total: number = $derived.by(() => this.#items.length);
	counts: Record<IssueStatus, number> = $derived.by(() => countByStatus(this.#items));
	byStatus: Record<IssueStatus, Issue[]> = $derived.by(() => groupByStatus(this.#items));
}
