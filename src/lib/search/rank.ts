// Combining two rankings that do not share a scale.
//
// Lexical relevance and cosine similarity are not comparable numbers: one is a term-match
// score whose range depends on the corpus, the other is a bounded distance. Normalising
// them into a common range means picking a calibration that is wrong as soon as the corpus
// changes. Reciprocal Rank Fusion sidesteps that entirely by throwing the scores away and
// keeping only the order, which is the part both rankers agree is meaningful.
//
// Pure and dependency-free, because fusion is the part most likely to be quietly wrong: a
// mistake here degrades result quality without ever throwing.

/**
 * The RRF damping constant. 60 is the value from the original paper and the usual default;
 * it decides how quickly the value of a rank falls away, so a document ranked highly by one
 * ranker can still beat one ranked mediocre by both.
 */
export const RRF_K = 60;

/**
 * Fuses ranked id lists into one ranking: score = Σ 1/(k + rank).
 *
 * Ties break by the order the id was first seen, which makes the result deterministic and
 * keeps the first list's preference when everything else is equal.
 */
export function fuseRanks(lists: ReadonlyArray<readonly string[]>, k: number = RRF_K): string[] {
	const scores = new Map<string, number>();
	const firstSeen = new Map<string, number>();
	let order = 0;

	for (const list of lists) {
		for (let rank = 0; rank < list.length; rank += 1) {
			const id = list[rank];
			if (id === undefined) continue;
			scores.set(id, (scores.get(id) ?? 0) + 1 / (k + rank + 1));
			if (!firstSeen.has(id)) firstSeen.set(id, order++);
		}
	}

	return [...scores.keys()].sort((a, b) => {
		const difference = (scores.get(b) ?? 0) - (scores.get(a) ?? 0);
		if (difference !== 0) return difference;
		return (firstSeen.get(a) ?? 0) - (firstSeen.get(b) ?? 0);
	});
}

/**
 * Cosine similarity of two equal-length vectors.
 *
 * Embeddings from the model are already L2-normalised, in which case this is just the dot
 * product — but the magnitudes are computed anyway so the function is correct for any
 * input, and the cost is irrelevant next to the embedding itself.
 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
	if (a.length !== b.length || a.length === 0) return 0;
	let dot = 0;
	let magnitudeA = 0;
	let magnitudeB = 0;
	for (let i = 0; i < a.length; i += 1) {
		const x = a[i] as number;
		const y = b[i] as number;
		dot += x * y;
		magnitudeA += x * x;
		magnitudeB += y * y;
	}
	if (magnitudeA === 0 || magnitudeB === 0) return 0;
	return dot / Math.sqrt(magnitudeA * magnitudeB);
}

/** One scored candidate from the semantic pass. */
export interface Scored {
	id: string;
	score: number;
}

/**
 * The `limit` most similar ids, highest first.
 *
 * A full sort of 10,000 candidates per keystroke would be wasteful when only a handful are
 * shown, so this keeps a bounded list and inserts into it.
 */
export function topBySimilarity(scored: readonly Scored[], limit: number): string[] {
	if (limit <= 0) return [];
	const best: Scored[] = [];
	for (const candidate of scored) {
		if (best.length === limit && candidate.score <= (best[best.length - 1]?.score ?? 0)) continue;
		let index = best.length;
		while (index > 0 && (best[index - 1]?.score ?? 0) < candidate.score) index -= 1;
		best.splice(index, 0, candidate);
		if (best.length > limit) best.pop();
	}
	return best.map((candidate) => candidate.id);
}
