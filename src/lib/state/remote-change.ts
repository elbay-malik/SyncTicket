// What someone else just did, as plain data and pure functions.
//
// Real-time sync is the one thing every visitor comes to check, and before this module a
// peer's edit reached the DOM in 3-29 ms and left no trace at all: no flash, no announcement,
// a status change simply made the row jump to another section, usually off-screen. This is
// the decision half of fixing that — which transactions count as "someone else, live", what
// kind of change each one was, and how to say it in a sentence. The reactive half, the
// time-bounded record the rows read, is `remote-activity.svelte.ts`; the Yjs half, reading
// the transaction, stays in the store, which is the only thing that sees one.
//
// Nothing here imports Yjs or runes, so all of it runs under the Node test project.

import { STATUS_META, type Issue, type IssueStatus } from '$lib/model/issue.js';
import { listNames } from '$lib/format.js';

/**
 * How long a row or card carries the trace of a remote change.
 *
 * Long against this system's 100-200ms interface motion on purpose, for the same reason the
 * quick-add flash is 500ms: this is not feedback for something the viewer did, it is news
 * about something they did not, and it has to be noticeable from the corner of an eye. Short
 * enough that a peer working through a column does not leave a lit trail behind them.
 */
export const TRACE_MS = 1200;

/**
 * Where in the trace a *continued* run picks up: the end of the fade-in (8% in the keyframes).
 *
 * A peer typing commits every 400ms of idle, and each commit is a fresh change to the same
 * row. Replaying the trace from zero each time made the row blink at the rhythm of their
 * typing; starting a continuation already at full strength holds it steady instead, and it
 * fades once, after they stop.
 */
export const TRACE_HOLD_FROM_MS = TRACE_MS * 0.08;

/**
 * How far into its trace a change already is, as a CSS animation delay (negative, so the
 * animation starts part-way through).
 *
 * Read when an element mounts, not reactively: a row that enters the virtual window, or is
 * rebuilt in the section a status change moved it to, should resume the fade where it is
 * instead of replaying it from the start. Clamped so a clock that went backwards plays the
 * whole trace rather than none of it. A change continuing a run that is already lit skips the
 * fade-in (`TRACE_HOLD_FROM_MS`), so a peer's steady typing holds the trace rather than
 * blinking it. Shared by the wash and the author's disc, so the two can never drift apart.
 */
export function traceDelay(change: RemoteChange, now: number): string {
	const elapsed = Math.min(TRACE_MS, Math.max(0, now - change.at));
	const continued = change.since !== undefined && change.since !== change.at;
	return `${-(continued ? Math.max(TRACE_HOLD_FROM_MS, elapsed) : elapsed)}ms`;
}

/** `deleted` is announced but never traced: there is no row left to draw it on. */
export type RemoteChangeKind = 'created' | 'status' | 'edited' | 'deleted';

/**
 * Who made a change, as far as this browser can tell.
 *
 * Only the fields presence has already validated: `hue` is the checked number avatars are
 * drawn from, never a colour string, so a trace can be built from it without handing a peer
 * any way into a style attribute.
 */
export interface RemoteAuthor {
	userId: string;
	name: string;
	hue: number;
}

export interface RemoteChange {
	issueId: string;
	kind: RemoteChangeKind;
	/** The issue's title after the change — before it, for a deletion. */
	title: string;
	/** Where the issue is now; for `status` that is where it was moved to. */
	status: IssueStatus;
	/**
	 * Null when the author cannot be resolved, and that is a normal case rather than an error:
	 * a deletion carries no author in Yjs at all (a delete set records what was removed, not
	 * by whom), and an edit can arrive a moment before the peer's awareness state does. The
	 * UI then says "Someone" — guessing from who else happens to be present would be the kind
	 * of overclaim the product refuses everywhere else.
	 */
	author: RemoteAuthor | null;
	/** When this browser received it, by this browser's clock. */
	at: number;
	/**
	 * When the unbroken run of remote changes to this issue that this one belongs to began —
	 * equal to `at` for a change that found the issue untraced. Set by `RemoteActivity`, which
	 * is the only thing that knows whether a trace was still running.
	 */
	since?: number;
}

/**
 * The fields a person edits. `order` and `updatedAt` are deliberately absent: a board drop
 * can rewrite *neighbouring* cards' order keys in the same transaction (`planRepairs`), so
 * counting order would light up cards nobody touched, and `updatedAt` changes with
 * everything and so says nothing.
 */
const EDITED_FIELDS = ['title', 'description', 'priority', 'assignee'] as const;

/** What kind of change turned `before` into `after`, or null when nobody would call it one. */
export function classifyChange(
	before: Issue | undefined,
	after: Issue | undefined
): RemoteChangeKind | null {
	if (!after) return before ? 'deleted' : null;
	if (!before) return 'created';
	// Status outranks every other field: it is the change that moves the row to another
	// section, and so the one the viewer most needs explained.
	if (before.status !== after.status) return 'status';
	for (const field of EDITED_FIELDS) {
		if (before[field] !== after[field]) return 'edited';
	}
	if (before.labels.join('\u0000') !== after.labels.join('\u0000')) return 'edited';
	return null;
}

/** The facts about one transaction that decide whether it is somebody else, live. */
export interface TransactionFacts {
	/** Yjs's own flag: false only for `applyUpdate`, i.e. bytes that came from elsewhere. */
	local: boolean;
	/** Applied by the relay provider, as opposed to IndexedDB loading this browser's copy. */
	fromRelay: boolean;
	/** The relay and this client had already exchanged state when it arrived. */
	relaySynced: boolean;
	/** This browser's own copy had finished loading from IndexedDB. */
	loaded: boolean;
}

/**
 * Whether a transaction is a peer's edit arriving now, as opposed to anything else that
 * changes the document.
 *
 * Each condition rules out one thing that would otherwise flash:
 * - `local` — this browser's own edits, and undo/redo of them, which transact locally (the
 *   UndoManager is their origin). Marking your own change in a peer's colour would be wrong
 *   twice over.
 * - `fromRelay` — IndexedDB hydrating this browser's own copy on load, which arrives through
 *   `applyUpdate` exactly like a peer's edit and would light up every row on every reload.
 * - `relaySynced` — the relay's catch-up. y-partyserver applies the server's SyncStep2 and
 *   only *then* flips `synced` to true (`readSyncMessage` before `provider.synced = true`,
 *   dist/provider/index.js ~20-34), so the whole existing workspace a visitor receives on
 *   opening a share link lands while this is still false. The same holds after a reconnect
 *   (`synced` drops on close), where the catch-up is a backlog, not news.
 * - `loaded` — belt and braces for a relay that answers before IndexedDB does.
 */
export function isLiveRemote(facts: TransactionFacts): boolean {
	return !facts.local && facts.fromRelay && facts.relaySynced && facts.loaded;
}

/** Long titles are cut for speech and for the one-line notice, never mid-surrogate. */
const MAX_TITLE = 60;

function quoted(title: string): string {
	const chars = [...title.trim()];
	const text =
		chars.length > MAX_TITLE ? `${chars.slice(0, MAX_TITLE - 1).join('')}…` : chars.join('');
	return `“${text}”`;
}

function who(author: RemoteAuthor | null): string {
	return author?.name ?? 'Someone';
}

/** One change as a sentence: "Ada Lovelace moved “Fix login redirect” to Done". */
export function describeChange(change: RemoteChange): string {
	const title = quoted(change.title);
	switch (change.kind) {
		case 'created':
			return `${who(change.author)} added ${title}`;
		case 'status':
			return `${who(change.author)} moved ${title} to ${STATUS_META[change.status].label}`;
		case 'edited':
			return `${who(change.author)} edited ${title}`;
		case 'deleted':
			return `${who(change.author)} deleted ${title}`;
	}
}

/**
 * A burst as one sentence.
 *
 * A seeded demo, a peer dragging five cards, or a reconnect that delivers a minute of edits
 * would otherwise be read out one change at a time for as long as it takes — and a screen
 * reader cannot be interrupted by the thing it is reading. One change keeps its full
 * sentence; more than one is counted, by author, because "who is busy" is the news.
 */
export function summarise(changes: readonly RemoteChange[]): string {
	if (changes.length === 0) return '';
	if (changes.length === 1) return describeChange(changes[0] as RemoteChange);
	const issues = new Set(changes.map((change) => change.issueId)).size;
	const names: string[] = [];
	for (const change of changes) {
		const name = who(change.author);
		if (!names.includes(name)) names.push(name);
	}
	if (issues === 1) {
		return `${listNames(names)} changed ${quoted((changes.at(-1) as RemoteChange).title)}`;
	}
	return names.length === 1
		? `${names[0]} changed ${issues} issues`
		: `${issues} issues changed by ${listNames(names)}`;
}

export interface AnnouncerTiming {
	/** How long to keep collecting after the first change of a burst. */
	settleMs: number;
	/** The least time between two announcements. */
	gapMs: number;
	/** How long a person must leave an issue alone before their edit to it is said. */
	quietMs: number;
	/** The least time between two announcements of edits to the same issue by the same person. */
	repeatMs: number;
}

export const ANNOUNCER_TIMING: AnnouncerTiming = {
	settleMs: 500,
	gapMs: 2000,
	quietMs: 1000,
	repeatMs: 10_000
};

/** An edit waiting for its author to stop: the latest change, and when the wait began. */
interface HeldEdit {
	change: RemoteChange;
	since: number;
	timer: ReturnType<typeof setTimeout>;
}

/**
 * Turns a stream of remote changes into a few polite announcements.
 *
 * Four rules, each against a specific failure:
 * - **Settle**: wait a beat after the first change and say the whole burst at once, so a
 *   five-card drag is one sentence rather than five queued ones.
 * - **Gap**: never speak twice inside `gapMs`. Polite regions queue rather than interrupt,
 *   so without a floor a busy peer would keep the reader talking indefinitely.
 * - **Quiet**: an edit is said once its author has left that issue alone for `quietMs`, and
 *   it is said with the latest change, not the first. A peer typing a title commits every
 *   400ms of idle (issue-editor.svelte), so the first edit to arrive carries whatever half a
 *   word existed at their first pause. Saying that one and dropping the rest told a screen
 *   reader a title that never existed and never told it the one that did — including when
 *   the peer pressed Escape and the title went back to what it was.
 * - **Repeat**: a peer who keeps typing, without ever going quiet, is still said at most once
 *   per `repeatMs` per issue — and the trailing announcement after they stop always comes,
 *   so what was said last is what the issue now says. Only `edited` is held: a status change
 *   or a creation is a finished fact the moment it happens.
 */
export class AnnouncementQueue {
	#emit: (message: string) => void;
	#timing: AnnouncerTiming;
	#pending: RemoteChange[] = [];
	#timer: ReturnType<typeof setTimeout> | null = null;
	#nextAllowed = 0;
	/** When each issue/author's edit was last said. */
	#lastSaid = new Map<string, number>();
	#held = new Map<string, HeldEdit>();

	constructor(emit: (message: string) => void, timing: AnnouncerTiming = ANNOUNCER_TIMING) {
		this.#emit = emit;
		this.#timing = timing;
	}

	push(change: RemoteChange): void {
		if (change.kind === 'edited') this.#hold(change);
		else this.#enqueue(change);
	}

	destroy(): void {
		if (this.#timer !== null) clearTimeout(this.#timer);
		this.#timer = null;
		this.#pending = [];
		for (const held of this.#held.values()) clearTimeout(held.timer);
		this.#held.clear();
	}

	#hold(change: RemoteChange): void {
		const now = Date.now();
		const key = `${change.issueId}\u0000${change.author?.userId ?? ''}`;
		const held = this.#held.get(key);
		if (held) clearTimeout(held.timer);
		const since = held?.since ?? now;
		const { quietMs, repeatMs } = this.#timing;
		const said = this.#lastSaid.get(key);
		// Quiet, and not sooner than `repeatMs` after the last time this was said — but never
		// later than `repeatMs` after the wait began, so someone typing without pause is still
		// heard about once in a while rather than only when they stop.
		const due = Math.min(
			Math.max(now + quietMs, said === undefined ? 0 : said + repeatMs),
			since + repeatMs
		);
		const timer = setTimeout(
			() => {
				this.#held.delete(key);
				this.#lastSaid.set(key, Date.now());
				this.#enqueue(change);
			},
			Math.max(0, due - now)
		);
		this.#held.set(key, { change, since, timer });
	}

	#enqueue(change: RemoteChange): void {
		this.#pending.push(change);
		if (this.#timer !== null) return;
		const wait = Math.max(this.#timing.settleMs, this.#nextAllowed - Date.now());
		this.#timer = setTimeout(this.#flush, wait);
	}

	#flush = (): void => {
		this.#timer = null;
		const message = summarise(this.#pending);
		this.#pending = [];
		const now = Date.now();
		this.#nextAllowed = now + this.#timing.gapMs;
		// Forget edits that can no longer hold anything back, so a long session does not keep a
		// key for every issue anyone ever touched.
		for (const [key, at] of this.#lastSaid) {
			if (now - at >= this.#timing.repeatMs) this.#lastSaid.delete(key);
		}
		if (message) this.#emit(message);
	};
}
