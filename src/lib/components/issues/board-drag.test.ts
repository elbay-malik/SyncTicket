// Each case here mirrors a real event sequence from svelte-dnd-action, taken from its
// source and confirmed against a live drag in the browser.

import { describe, expect, it } from 'vitest';
import { SOURCES, TRIGGERS, type DndEvent } from 'svelte-dnd-action';
import type { Issue } from '$lib/model/issue.js';
import { reduceConsider, reduceFinalize } from './board-drag.js';

const issue = (id: string): Issue => ({
	id,
	title: id,
	description: '',
	status: 'todo',
	priority: 'none',
	assignee: null,
	labels: [],
	order: 'a0',
	createdAt: 0,
	updatedAt: 0
});

const event = (
	ids: string[],
	info: { trigger: string; id: string; source: string }
): DndEvent<Issue> => ({ items: ids.map(issue), info }) as unknown as DndEvent<Issue>;

describe('reduceConsider', () => {
	it('previews while the pointer is moving', () => {
		const outcome = reduceConsider(
			'todo',
			event(['a', 'b'], { trigger: TRIGGERS.DRAGGED_OVER_INDEX, id: 'a', source: SOURCES.POINTER })
		);
		expect(outcome).toEqual({ kind: 'preview', status: 'todo', items: [issue('a'), issue('b')] });
	});

	it('commits on a keyboard drop, which never sends a finalize', () => {
		const outcome = reduceConsider(
			'todo',
			event(['a', 'b'], { trigger: TRIGGERS.DRAG_STOPPED, id: 'a', source: SOURCES.KEYBOARD })
		);
		expect(outcome).toEqual({
			kind: 'commit',
			status: 'todo',
			id: 'a',
			orderedIds: ['a', 'b'],
			source: SOURCES.KEYBOARD
		});
	});

	it('ends without writing when the drop landed in another column', () => {
		const outcome = reduceConsider(
			'todo',
			event(['b'], { trigger: TRIGGERS.DRAG_STOPPED, id: 'a', source: SOURCES.KEYBOARD })
		);
		expect(outcome).toEqual({ kind: 'end' });
	});
});

describe('reduceFinalize', () => {
	it('commits a pointer drop in the column that received the card', () => {
		const outcome = reduceFinalize(
			'done',
			event(['x', 'a'], {
				trigger: TRIGGERS.DROPPED_INTO_ANOTHER,
				id: 'a',
				source: SOURCES.POINTER
			})
		);
		expect(outcome).toEqual({
			kind: 'commit',
			status: 'done',
			id: 'a',
			orderedIds: ['x', 'a'],
			source: SOURCES.POINTER
		});
	});

	it('only ends in the origin column, which no longer holds the card', () => {
		const outcome = reduceFinalize(
			'todo',
			event(['b'], { trigger: TRIGGERS.DROPPED_INTO_ANOTHER, id: 'a', source: SOURCES.POINTER })
		);
		expect(outcome).toEqual({ kind: 'end' });
	});

	it('writes nothing when the card was released outside every column', () => {
		// The library restores the card to its original slot and still sends a finalize whose
		// items contain the dragged id, so the trigger is the only thing distinguishing it.
		const outcome = reduceFinalize(
			'todo',
			event(['a', 'b'], {
				trigger: TRIGGERS.DROPPED_OUTSIDE_OF_ANY,
				id: 'a',
				source: SOURCES.POINTER
			})
		);
		expect(outcome).toEqual({ kind: 'end' });
	});

	it('treats every keyboard finalize as a step, not a drop', () => {
		// Arrow presses and Tabs each fire finalize mid-drag; committing them would mint one
		// order key per keystroke.
		const outcome = reduceFinalize(
			'todo',
			event(['b', 'a'], {
				trigger: TRIGGERS.DROPPED_INTO_ZONE,
				id: 'a',
				source: SOURCES.KEYBOARD
			})
		);
		expect(outcome).toEqual({ kind: 'preview', status: 'todo', items: [issue('b'), issue('a')] });
	});
});

describe('a full keyboard drag across columns', () => {
	it('previews every step and writes exactly once, in the target column', () => {
		const outcomes: string[] = [];
		// Space: the drag begins.
		outcomes.push(
			reduceConsider(
				'backlog',
				event(['a', 'b'], { trigger: TRIGGERS.DRAG_STARTED, id: 'a', source: SOURCES.KEYBOARD })
			).kind
		);
		// Tab: the library moves the card and finalizes in both columns.
		outcomes.push(
			reduceFinalize(
				'backlog',
				event(['b'], { trigger: TRIGGERS.DROPPED_INTO_ANOTHER, id: 'a', source: SOURCES.KEYBOARD })
			).kind
		);
		outcomes.push(
			reduceFinalize(
				'todo',
				event(['a'], { trigger: TRIGGERS.DROPPED_INTO_ZONE, id: 'a', source: SOURCES.KEYBOARD })
			).kind
		);
		// Space: the drop, reported as a consider.
		outcomes.push(
			reduceConsider(
				'todo',
				event(['a'], { trigger: TRIGGERS.DRAG_STOPPED, id: 'a', source: SOURCES.KEYBOARD })
			).kind
		);
		expect(outcomes).toEqual(['preview', 'preview', 'preview', 'commit']);
	});
});
