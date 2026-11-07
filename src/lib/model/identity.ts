// Who you are, without accounts.
//
// ADR 0004 rules out authentication, so identity is self-declared: a friendly name and a
// colour, generated on first use so two browsers can meet with no setup at all. It is a
// label for a cursor, not a claim about anyone — nothing is authorised by it.

/** Adjectives and animals make names that are easy to say out loud in a demo. */
const ADJECTIVES = [
	'Amber',
	'Brisk',
	'Calm',
	'Copper',
	'Eager',
	'Fleet',
	'Golden',
	'Hazel',
	'Indigo',
	'Jade',
	'Keen',
	'Lively',
	'Merry',
	'Noble',
	'Olive',
	'Quiet',
	'Rapid',
	'Silver',
	'Teal',
	'Vivid'
];

const ANIMALS = [
	'Fox',
	'Heron',
	'Otter',
	'Falcon',
	'Badger',
	'Marten',
	'Osprey',
	'Lynx',
	'Ibis',
	'Hare',
	'Wren',
	'Stoat',
	'Raven',
	'Puffin',
	'Seal',
	'Kite'
];

/**
 * Hues spread around the wheel, chosen so neighbouring peers are easy to tell apart.
 *
 * Stored as a hue rather than a finished colour: the UI renders it through oklch with its
 * own lightness and chroma, so one hue works in both themes instead of one palette being
 * unreadable in the other.
 */
export const PEER_HUES = [12, 45, 80, 140, 180, 210, 265, 300, 330] as const;

export interface Identity {
	/**
	 * Stable across reloads and tabs, so one person is one avatar rather than one per tab.
	 *
	 * Not a credential: it is self-minted, freely forgeable and authorises nothing (ADR 0004).
	 * It exists only to group a human's sessions together in the UI.
	 */
	userId: string;
	name: string;
	/** Degrees on the colour wheel, 0–360. */
	hue: number;
}

/** Where this browser remembers who it is. */
export const IDENTITY_STORAGE_KEY = 'syncticket:identity';
/**
 * The presence id this browser uses in each workspace, as `{ [workspaceId]: userId }`. One id for
 * every workspace let anyone in two of them tell that the same browser was in both.
 */
export const PRESENCE_IDS_STORAGE_KEY = 'syncticket:presence-ids';
/** How many workspaces' presence ids are kept; the oldest go first. */
const PRESENCE_IDS_LIMIT = 50;

/** Display names are user-supplied and rendered beside other people's content. */
export const MAX_NAME_LENGTH = 32;

/**
 * Trims, collapses whitespace and caps length; empty input keeps the previous name.
 *
 * Control and format characters are removed, not merely trimmed. A name arrives over the
 * wire from anyone holding the workspace link, and is rendered beside other people's
 * content: a bidi override (U+202E) would reverse the text around it, and a zero-width
 * space would let two peers wear the same visible name. Whitespace is folded to spaces
 * first so a newline becomes a word break rather than vanishing and joining two words.
 * The cost is that emoji joined by U+200D lose their joiner, which is a fair trade for a
 * display label.
 */
export function normaliseName(input: string, fallback: string): string {
	const cleaned = input
		.replace(/\s/gu, ' ')
		.replace(/[\p{C}\p{Zl}\p{Zp}]/gu, '')
		.replace(/ +/g, ' ')
		.trim()
		.slice(0, MAX_NAME_LENGTH)
		.trim();
	return cleaned || fallback;
}

/**
 * A deterministic stand-in for `Math.random`, seeded by a string.
 *
 * Repairing an identity that arrived over the wire needs replacement values, and a random
 * one would give a peer a different colour on every repaint. Seeding on the peer's user id
 * makes the repair stable instead. Not a cryptographic generator and not used as one.
 */
export function seededRandom(seed: string): () => number {
	let h = 2166136261 >>> 0;
	for (let i = 0; i < seed.length; i += 1) {
		h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
	}
	return () => {
		h = (h + 0x6d2b79f5) | 0;
		let t = h;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function pick<T>(list: readonly T[], random: () => number): T {
	return list[Math.floor(random() * list.length)] as T;
}

/**
 * A number in [0, 1) from the platform's secure generator. An id is only as unguessable as what
 * it is drawn from, and `Math.random` is not built to be.
 */
export function secureRandom(): number {
	const words = new Uint32Array(1);
	crypto.getRandomValues(words);
	return words[0]! / 4294967296;
}

/** 128 bits of id from the injected source, so tests stay deterministic. */
function mintUserId(random: () => number): string {
	let id = 'u';
	for (let i = 0; i < 32; i += 1) id += Math.floor(random() * 16).toString(16);
	return id;
}

/**
 * This browser's presence id in `workspaceId`, minting one the first time. `stored` is what
 * `PRESENCE_IDS_STORAGE_KEY` held, which anything on this origin can write, so only ids of the
 * right shape are kept. Returns the id and the map to store back.
 */
export function workspaceUserId(
	stored: unknown,
	workspaceId: string,
	random: () => number = secureRandom
): { userId: string; ids: Record<string, string> } {
	const ids: Record<string, string> = {};
	if (typeof stored === 'object' && stored !== null && !Array.isArray(stored)) {
		for (const [key, value] of Object.entries(stored)) {
			if (typeof value === 'string' && USER_ID.test(value)) ids[key] = value;
		}
	}
	const userId = ids[workspaceId] ?? mintUserId(random);
	delete ids[workspaceId];
	const kept = Object.entries(ids).slice(-(PRESENCE_IDS_LIMIT - 1));
	return { userId, ids: Object.fromEntries([...kept, [workspaceId, userId]]) };
}

/** A fresh identity. `random` is injectable so tests are deterministic. */
export function createIdentity(random: () => number = secureRandom): Identity {
	return {
		userId: mintUserId(random),
		name: `${pick(ADJECTIVES, random)} ${pick(ANIMALS, random)}`,
		hue: pick(PEER_HUES, random)
	};
}

/** Ids are echoed back into the DOM as keys, so they are checked, not trusted. */
const USER_ID = /^u[0-9a-f]{32}$/;

/** The letters shown in an avatar when there is no room for the whole name. */
export function initialsOf(name: string): string {
	const words = name.split(' ').filter(Boolean);
	if (words.length === 0) return '?';
	if (words.length === 1) return (words[0] as string).slice(0, 2).toUpperCase();
	return `${(words[0] as string)[0]}${(words[1] as string)[0]}`.toUpperCase();
}

/**
 * Recovers an identity from whatever was remembered, repairing anything unusable.
 *
 * The same function validates identities arriving from other peers, which is the point:
 * awareness state is written by anyone holding the workspace link, so every field is
 * attacker-controlled until it has been through here.
 */
export function parseIdentity(stored: unknown, random: () => number = Math.random): Identity {
	const fallback = createIdentity(random);
	if (typeof stored !== 'object' || stored === null) return fallback;
	const value = stored as { userId?: unknown; name?: unknown; hue?: unknown };
	const userId =
		typeof value.userId === 'string' && USER_ID.test(value.userId) ? value.userId : fallback.userId;
	const name =
		typeof value.name === 'string' ? normaliseName(value.name, fallback.name) : fallback.name;
	const hue =
		typeof value.hue === 'number' && Number.isFinite(value.hue) && value.hue >= 0 && value.hue < 360
			? value.hue
			: fallback.hue;
	return { userId, name, hue };
}
