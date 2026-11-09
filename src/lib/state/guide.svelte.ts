// The first-visit guide: a small "Try this" card, and whether it is showing.
//
// Shown once per visit until the visitor chooses "Don't show again", which is the only thing
// stored. One key, versioned: when the card's steps change, bumping the version shows the new
// ones once to everyone who dismissed the old. Nothing else is recorded about the guide, and
// nothing about it leaves the browser.
//
// Storage can be refused outright (a browser set to block site data throws on any access, and
// app.html's stand-in only exists when that happens before the app loads). Every read and write
// is guarded, and a failure means the card behaves as if never dismissed: it shows, and closes
// for the visit.

import { GUIDE_KEY } from './guide-key.js';

export { GUIDE_KEY };

export const guide = $state({
	open: false,
	/** Set when the visitor asked for the card, so it takes focus; cleared once it has. */
	focusOnOpen: false
});

export function guideDismissed(): boolean {
	try {
		return localStorage.getItem(GUIDE_KEY) === 'dismissed';
	} catch {
		return false;
	}
}

const CHANNEL = 'syncticket-guide';
/** How long a new window waits to hear whether another one is already open. */
export const ANSWER_WAIT_MS = 250;

let channel: BroadcastChannel | null = null;

/**
 * Opens the card on a first visit, unless another SyncTicket window in this browser answers
 * within a moment. That is the window the card's own first step opens: a card over the demo in
 * the window meant to prove it would be in the way. Not decided by the address: after the first
 * visit every address carries `?ws=`, so a reload or a bookmark looks exactly like a share link,
 * and the second window's address is the first's. The reopen button works in every window.
 */
export function startGuide(): void {
	if (typeof BroadcastChannel === 'undefined') {
		if (!guideDismissed()) guide.open = true;
		return;
	}
	channel?.close();
	channel = new BroadcastChannel(CHANNEL);
	let answered = false;
	channel.onmessage = (event: MessageEvent) => {
		if (event.data === 'anyone') channel?.postMessage('here');
		else if (event.data === 'here') answered = true;
	};
	channel.postMessage('anyone');
	setTimeout(() => {
		if (!answered && !guideDismissed()) guide.open = true;
	}, ANSWER_WAIT_MS);
}

/** Leaves the conversation, for tests and for a window going away. */
export function stopGuide(): void {
	channel?.close();
	channel = null;
}

/** Asked for, from the header button or the palette: the card opens and takes focus. */
export function showGuide(): void {
	guide.open = true;
	guide.focusOnOpen = true;
}

/** For this visit only: a reload shows it again until "Don't show again". */
export function closeGuide(): void {
	guide.open = false;
}

export function dismissGuide(): void {
	guide.open = false;
	try {
		localStorage.setItem(GUIDE_KEY, 'dismissed');
	} catch {
		// Refused: closed for this visit, which is all that can be done.
	}
}
