// A chain does not have to overflow anything to hurt. One transaction setting a key on every level
// raises one event per level, and stock Yjs filed each event under every ancestor and worked out
// each event's whole path to sort them, with the store then reading each path again and re-reading
// the issue once per event. That is quadratic memory and worse than quadratic time from a few bytes
// a level, so a 168 KB update stalled every open tab for most of a minute and could run the relay
// out of memory. patches/yjs@*.patch and `touchedEntries` make it linear.

import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import {
	JUNK_ID,
	REAL_ID,
	SLOT_ID,
	everyLevelTouched,
	peerWrites,
	wellFormedIssue
} from './junk-entries.fixture.js';
import { createDoc, getIssuesMap, touchedEntries } from './doc.js';

const DEPTH = 12_000;

function loaded(depth: number) {
	const doc = createDoc();
	const { chain, touch } = everyLevelTouched(depth);
	Y.applyUpdate(doc, chain);
	return { doc, map: getIssuesMap(doc), touch };
}

describe('one update touching every level of a chain', () => {
	it('costs about the same per level however deep the chain is', { timeout: 120_000 }, () => {
		const { doc, map, touch } = loaded(DEPTH);
		const touched: unknown[] = [];
		map.observeDeep((events) => touched.push(touchedEntries(map, events)));

		const started = performance.now();
		Y.applyUpdate(doc, touch);
		const elapsed = performance.now() - started;

		// Stock Yjs took 33 s for this on the machine this was written on, and most of it with no
		// observer involved. Linear work takes a small fraction of that even on a loaded runner.
		expect(elapsed).toBeLessThan(5_000);
		expect(touched).toEqual([[{ id: REAL_ID, event: expect.anything() }]]);
	});

	it('does not file each event under every ancestor', () => {
		const depth = 2_000;
		const { doc, map, touch } = loaded(depth);
		map.observeDeep(() => {});
		let filed = 0;
		doc.on('afterTransaction', (transaction: Y.Transaction) => {
			for (const events of transaction.changedParentTypes.values()) filed += events.length;
		});

		Y.applyUpdate(doc, touch);

		// One list, the observed map's, holding each level's one event. Stock Yjs held two million.
		expect(filed).toBe(depth);
	});

	it('delivers every event to the observer, shallowest first', () => {
		const depth = 50;
		const { doc, map, touch } = loaded(depth);
		const seen = vi.fn();
		map.observeDeep(seen);

		Y.applyUpdate(doc, touch);

		const events = seen.mock.calls[0]?.[0] as Array<Y.YEvent<Y.Map<unknown>>>;
		expect(seen).toHaveBeenCalledTimes(1);
		expect(events).toHaveLength(depth);
		const lengths = events.map((event) => event.path.length);
		expect(lengths).toEqual([...lengths].sort((a, b) => a - b));
		expect(events[0]?.path).toEqual([REAL_ID, 'zzz']);
		expect(events.at(-1)?.path).toHaveLength(depth + 1);
	});
});

describe('what filing events only where they are wanted must not change', () => {
	/** issues[id].outer.inner.leaf, with a separate branch beside `inner`. */
	function tree() {
		const doc = createDoc();
		const map = getIssuesMap(doc);
		peerWrites(
			doc,
			(issues) => {
				const yIssue = wellFormedIssue();
				issues.set(REAL_ID, yIssue);
				const outer = new Y.Map<unknown>();
				yIssue.set('outer', outer);
				const inner = new Y.Map<unknown>();
				outer.set('inner', inner);
				const beside = new Y.Map<unknown>();
				outer.set('beside', beside);
			},
			'relay'
		);
		const yIssue = map.get(REAL_ID) as Y.Map<unknown>;
		const outer = yIssue.get('outer') as Y.Map<unknown>;
		return {
			doc,
			map,
			yIssue,
			outer,
			inner: outer.get('inner') as Y.Map<unknown>,
			beside: outer.get('beside') as Y.Map<unknown>
		};
	}

	it('still reaches an observer at any level, with only what is under it', () => {
		const { doc, map, outer, inner, beside } = tree();
		const atRoot = vi.fn();
		const atOuter = vi.fn();
		const atInner = vi.fn();
		const atBeside = vi.fn();
		map.observeDeep(atRoot);
		outer.observeDeep(atOuter);
		inner.observeDeep(atInner);
		beside.observeDeep(atBeside);

		doc.transact(() => {
			inner.set('a', 1);
			outer.set('b', 2);
		});

		expect(atRoot.mock.calls[0]?.[0]).toHaveLength(2);
		expect(atOuter.mock.calls[0]?.[0]).toHaveLength(2);
		expect(atInner.mock.calls[0]?.[0]).toHaveLength(1);
		expect(atBeside).not.toHaveBeenCalled();
	});

	it('still works out a path for whichever observer reads one', () => {
		const { doc, map, inner } = tree();
		const paths: unknown[] = [];
		map.observeDeep((events) => paths.push(...events.map((event) => event.path)));

		doc.transact(() => inner.set('a', 1));

		expect(paths).toEqual([[REAL_ID, 'outer', 'inner']]);
	});

	it('still leaves events out once their target has been deleted', () => {
		const { doc, map, outer, inner } = tree();
		const seen = vi.fn();
		map.observeDeep(seen);

		doc.transact(() => {
			inner.set('a', 1);
			outer.delete('inner');
		});

		const events = seen.mock.calls[0]?.[0] as Array<Y.YEvent<Y.Map<unknown>>>;
		expect(events.map((event) => event.target)).toEqual([outer]);
	});

	it('still marks every ancestor as changed, which is how an UndoManager checks its scope', () => {
		const { doc, map, yIssue, outer, inner } = tree();
		let marked: boolean[] = [];
		doc.on('afterTransaction', (transaction: Y.Transaction) => {
			marked = [map, yIssue, outer, inner].map((type) =>
				transaction.changedParentTypes.has(type as never)
			);
		});

		doc.transact(() => inner.set('a', 1));

		expect(marked).toEqual([true, true, true, true]);
		const undo = new Y.UndoManager(outer, { captureTimeout: 0 });
		inner.set('b', 1);
		expect(undo.canUndo()).toBe(true);
		undo.destroy();
	});
});

describe('touchedEntries', () => {
	function collected(write: (issues: Y.Map<unknown>) => void) {
		const doc = createDoc();
		const map = getIssuesMap(doc);
		peerWrites(
			doc,
			(issues) => {
				issues.set(REAL_ID, wellFormedIssue({ zzz: new Y.Map([['k', new Y.Map()]]) }));
				issues.set(SLOT_ID, wellFormedIssue());
				issues.set(JUNK_ID, new Y.Array());
			},
			'relay'
		);
		let result: ReturnType<typeof touchedEntries> = [];
		map.observeDeep((events) => {
			result = touchedEntries(map, events);
		});
		peerWrites(doc, write, 'relay');
		return { result, map };
	}

	it('names each entry once, with the shallowest event that touched it', () => {
		const { result, map } = collected((issues) => {
			const yIssue = issues.get(REAL_ID) as Y.Map<unknown>;
			const nested = yIssue.get('zzz') as Y.Map<unknown>;
			(nested.get('k') as Y.Map<unknown>).set('deep', 1);
			nested.set('mid', 1);
			yIssue.set('title', 'Renamed');
			(issues.get(SLOT_ID) as Y.Map<unknown>).set('title', 'Other');
			issues.set('new-key', 'junk');
		});

		expect(result.map(({ id }) => id).sort()).toEqual(['new-key', REAL_ID, SLOT_ID].sort());
		const first = result.find(({ id }) => id === REAL_ID);
		expect(first?.event.target).toBe(map.get(REAL_ID));
		expect(result.find(({ id }) => id === 'new-key')?.event.target).toBe(map);
	});

	it('names the entry an edit inside something that is not an issue landed in', () => {
		const { result } = collected((issues) => {
			(issues.get(JUNK_ID) as Y.Array<unknown>).push(['x']);
		});

		expect(result.map(({ id }) => id)).toEqual([JUNK_ID]);
	});
});
