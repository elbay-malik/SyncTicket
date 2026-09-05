// Label text normalisation — pure, no Yjs, no runes. The UI edits labels as a single
// comma-separated string; the CRDT stores them as a string[] (see sync/issues.ts).

/**
 * Parses user-entered "a, b, c" into a clean label array: split on commas, trim, drop
 * empties, dedupe (case-sensitive, first occurrence wins), preserve entry order.
 */
export function parseLabels(text: string): string[] {
	const seen = new Set<string>();
	const labels: string[] = [];
	for (const raw of text.split(',')) {
		const label = raw.trim();
		if (!label || seen.has(label)) continue;
		seen.add(label);
		labels.push(label);
	}
	return labels;
}

/** Inverse of parseLabels for display in an input: "a, b, c". */
export function formatLabels(labels: readonly string[]): string {
	return labels.join(', ');
}

/** Order-sensitive equality — used to avoid writing a no-op labels patch. */
export function labelsEqual(a: readonly string[], b: readonly string[]): boolean {
	return a.length === b.length && a.every((label, index) => label === b[index]);
}
