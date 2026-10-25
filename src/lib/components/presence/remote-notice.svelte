<script lang="ts" module>
	/**
	 * Whether at least half of `el`, in each direction, survives being clipped by the viewport
	 * and by every ancestor that clips. Every ancestor rather than one named scroller, because
	 * the views differ in what clips: the list scrolls itself at desktop heights and leaves it
	 * to <main> at short ones, and a board card sits inside its column's scroller inside the
	 * board's horizontal one.
	 */
	export function onScreen(el: HTMLElement): boolean {
		const rect = el.getBoundingClientRect();
		let top = Math.max(rect.top, 0);
		let bottom = Math.min(rect.bottom, window.innerHeight);
		let left = Math.max(rect.left, 0);
		let right = Math.min(rect.right, window.innerWidth);
		for (let at = el.parentElement; at; at = at.parentElement) {
			const style = getComputedStyle(at);
			if (style.overflowX === 'visible' && style.overflowY === 'visible') continue;
			const box = at.getBoundingClientRect();
			top = Math.max(top, box.top);
			bottom = Math.min(bottom, box.bottom);
			left = Math.max(left, box.left);
			right = Math.min(right, box.right);
		}
		return bottom - top >= rect.height / 2 && right - left >= rect.width / 2;
	}
</script>

<script lang="ts">
	import { tick } from 'svelte';
	import { describeChange, type RemoteChange } from '$lib/state/remote-change.js';
	import type { RemoteActivity } from '$lib/state/remote-activity.svelte.js';
	import PeerAvatars from './peer-avatars.svelte';

	let {
		activity,
		listed,
		find
	}: {
		activity: RemoteActivity;
		/** Whether the view has a place for this issue at all — false when filtered out. */
		listed: (issueId: string) => boolean;
		/** The issue's element in this view, or null while it is not (yet) rendered. */
		find: (issueId: string) => HTMLElement | null;
	} = $props();

	/**
	 * A peer's change the viewer cannot see, said in one line at the foot of the screen.
	 *
	 * The trace marks a remote change where it lands, but a status change moves the row to
	 * another section or column — often out of view — and a filtered list drops it altogether.
	 * Scrolling the viewer there would take their place away from them for an edit they did
	 * not make, and marking the destination heading fails the same way the trace does whenever
	 * the heading is off-screen too. A line pinned to the viewport is the one cue that is
	 * always where the viewer is looking, so it is the only one: shown just for changes whose
	 * row or card is *not* on screen, so the two never say the same thing twice. Visual only —
	 * the presence bar's live region already says it to a screen reader, and a second voice
	 * here would read every off-screen change twice.
	 */
	let notice = $state<RemoteChange | null>(null);
	/**
	 * What the notice is keyed on, so it replays its fade-in for news and only for news. A
	 * peer typing into an off-screen issue commits every 400ms of idle, and keying on each
	 * change's arrival remounted the line at the rhythm of their typing — the blink
	 * `TRACE_HOLD_FROM_MS` exists to stop on the row. A change that continues the issue
	 * already on show, by the same person, updates the sentence in place instead.
	 */
	let noticeRun = $state(0);
	let noticeTimer: ReturnType<typeof setTimeout> | undefined;
	/** Long enough to read a sentence that appeared while looking elsewhere; then it goes. */
	const NOTICE_MS = 4000;
	/**
	 * How many frames to wait for a view to render an element that is listed but not yet in
	 * the DOM. One frame is not always enough: back-to-back arrivals each change the list, and
	 * virtua places a new row only once it has re-rendered for the new data — a row looked for
	 * before then was counted as off-screen while it sat in plain view. Still missing after
	 * this many frames, it is outside what the view renders (virtua's window, a column's cap),
	 * the one case where its absence does mean "not on screen".
	 */
	const PLACEMENT_FRAMES = 6;

	function show(change: RemoteChange) {
		const continues =
			notice !== null &&
			notice.issueId === change.issueId &&
			notice.author?.userId === change.author?.userId;
		if (!continues) noticeRun += 1;
		notice = change;
		clearTimeout(noticeTimer);
		noticeTimer = setTimeout(() => (notice = null), NOTICE_MS);
	}

	/** Shows the notice unless the change's element is, or is about to be, in plain view. */
	function judge(change: RemoteChange, framesLeft: number) {
		// Deleted, or filtered out of this view: there is nothing to wait for.
		if (change.kind === 'deleted' || !listed(change.issueId)) return show(change);
		const el = find(change.issueId);
		if (el === null && framesLeft > 0) {
			requestAnimationFrame(() => judge(change, framesLeft - 1));
			return;
		}
		if (el === null || !onScreen(el)) show(change);
	}

	$effect(() => {
		const unsubscribe = activity.subscribe((change) => {
			// The record lands inside the Yjs observer, before Svelte has rendered the change and
			// before the view has placed it in its new section or column; judge where it ended
			// up, not where it was.
			void tick().then(() => requestAnimationFrame(() => judge(change, PLACEMENT_FRAMES)));
		});
		return () => {
			unsubscribe();
			clearTimeout(noticeTimer);
		};
	});
</script>

{#if notice}
	{@const author = notice.author}
	<!-- Fixed to the viewport, not to the view: at short heights the list is taller than the
	     screen and <main> scrolls it, so the list's own foot can be off-screen too. Floating,
	     so it takes the floating-layer vocabulary (shadow-md, ring-1). pointer-events-none and
	     no controls: it asks nothing of the viewer and can never sit on top of a click.
	     Keyed by run (`noticeRun`), so news replays the short fade-in and a peer's continued
	     typing on the same issue only rewrites the sentence.

	     Two lines rather than one: the sentence ends with where the issue went, and a single
	     truncated line at phone width cut exactly that ("…moved “Support pasting a mul…"). -->
	{#key noticeRun}
		<div
			class="remote-notice bg-popover text-popover-foreground ring-foreground/10 pointer-events-none fixed inset-x-4 bottom-4 z-40 mx-auto flex w-fit max-w-[min(32rem,calc(100vw-2rem))] items-center gap-2 rounded-lg px-3 py-2 text-xs shadow-md ring-1"
			aria-hidden="true"
			data-testid="remote-notice"
		>
			{#if author}
				<PeerAvatars
					peers={[{ ...author, activeIssueId: null, sessions: 1 }]}
					size="sm"
					summary=""
				/>
			{/if}
			<span class="line-clamp-2" data-remote-notice-text>{describeChange(notice)}</span>
		</div>
	{/key}
{/if}
