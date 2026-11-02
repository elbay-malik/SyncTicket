// What the unit tests cannot show: a real relay, under real workerd, writing to and reading from its
// real SQLite file, and the document coming back after the room has been made to reload.
//
// `wrangler dev` cannot force a hibernation eviction, so these tests do something stronger: they
// stop the whole process and start it again on the same state directory, which leaves nothing in
// memory, and every `onLoad` below reads only what reached the disk. That needs a relay of its own,
// because Playwright owns the one in playwright.config.ts. The row can be read and planted directly
// because a Durable Object's storage is an ordinary SQLite file, once the process has stopped.

import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { createConnection } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import YProvider from 'y-partyserver/provider';
import * as Y from 'yjs';
import { parsePersistenceNotice, type PersistenceNotice } from '../src/lib/sync/relay-notice.js';
import {
	UNRELOADABLE_BASE,
	UNRELOADABLE_UPDATE
} from '../workers/relay/src/unreloadable.fixture.js';
import { expect, test, type Page } from './fixtures.js';

/** Must match RELAY_PARTY in src/lib/sync/provider.ts. */
const RELAY_PARTY = 'y-doc-room';
/** The relay Playwright starts, for the one test that needs the real page. */
const SUITE_RELAY_HOST = 'localhost:18791';
/** Clear of the suite's relay at 18791; each test stops its relay before the next one starts it. */
const OWN_RELAY_PORT = 18792;
/** Past the relay's save ceiling (`debounceMaxWait: 5000`). */
const SAVE_WINDOW_MS = 6_000;

test.setTimeout(180_000);

/** One `wrangler dev`, restartable on the same state directory. */
class OwnRelay {
	readonly host = `localhost:${OWN_RELAY_PORT}`;
	readonly state = mkdtempSync(join(tmpdir(), 'syncticket-relay-damage-'));
	readonly output: string[] = [];
	#process: ChildProcess | null = null;

	async start(): Promise<void> {
		const process = spawn(
			'pnpm',
			[
				'--filter',
				'syncticket-relay',
				'exec',
				'wrangler',
				'dev',
				'--port',
				String(OWN_RELAY_PORT),
				'--persist-to',
				this.state,
				'--env',
				'e2e'
			],
			{ detached: true, stdio: ['ignore', 'pipe', 'pipe'] }
		);
		process.stdout.on('data', (chunk) => this.output.push(String(chunk)));
		process.stderr.on('data', (chunk) => this.output.push(String(chunk)));
		this.#process = process;
		await expect
			.poll(
				async () => {
					try {
						return await (await fetch(`http://${this.host}/`)).text();
					} catch {
						return null;
					}
				},
				{ timeout: 60_000, intervals: [250] }
			)
			.toBe('syncticket relay');
	}

	/** Takes the whole process group down, so workerd goes too, and waits for the port to free. */
	async stop(): Promise<void> {
		const process = this.#process;
		this.#process = null;
		if (!process?.pid) return;
		const exited = new Promise((resolve) => process.once('close', resolve));
		globalThis.process.kill(-process.pid, 'SIGTERM');
		await exited;
		await expect
			.poll(() => portInUse(OWN_RELAY_PORT), { timeout: 15_000, intervals: [100] })
			.toBe(false);
	}

	/** Every `relay.persistence` line this relay has logged, across all of its restarts. */
	lines(event: string): string[] {
		return this.output
			.join('')
			.split('\n')
			.filter((line) => line.includes(`relay.persistence event=${event} `));
	}

	/** Opens the room's SQLite file. Only while the relay is stopped. */
	database(): DatabaseSync {
		const directory = join(this.state, 'v3/do/syncticket-relay-e2e-YDocRoom');
		const files = readdirSync(directory).filter(
			(name) => name.endsWith('.sqlite') && name !== 'metadata.sqlite'
		);
		expect(files).toHaveLength(1);
		return new DatabaseSync(join(directory, files[0] as string));
	}

	storage(): StoredRoom {
		const database = this.database();
		try {
			const row = (sql: string) =>
				database.prepare(sql).get() as Record<string, unknown> | undefined;
			const hasQuarantine = row(
				`SELECT 1 AS yes FROM sqlite_master WHERE type = 'table' AND name = 'ydoc_quarantine'`
			);
			return {
				snapshot: row('SELECT doc FROM ydoc_snapshot WHERE id = 1')?.doc,
				quarantine: hasQuarantine
					? row('SELECT doc FROM ydoc_quarantine WHERE id = 1')?.doc
					: undefined,
				health: row('SELECT state, reason, at FROM ydoc_health WHERE id = 1')
			};
		} finally {
			database.close();
		}
	}

	async dispose(): Promise<void> {
		await this.stop();
		rmSync(this.state, { recursive: true, force: true });
	}
}

interface StoredRoom {
	snapshot: unknown;
	quarantine: unknown;
	health: Record<string, unknown> | undefined;
}

function portInUse(port: number): Promise<boolean> {
	return new Promise((resolve) => {
		const socket = createConnection({ port, host: 'localhost' });
		socket.once('connect', () => {
			socket.destroy();
			resolve(true);
		});
		socket.once('error', () => resolve(false));
	});
}

function freshRoom(): string {
	return `t${crypto.randomUUID().replace(/-/g, '')}`;
}

/** A plain Yjs client on the room's socket, keeping every persistence notice it is sent. */
class Peer {
	readonly notices: PersistenceNotice[] = [];
	readonly provider: YProvider;

	constructor(
		host: string,
		room: string,
		readonly doc = new Y.Doc()
	) {
		this.provider = new YProvider(host, room, doc, { party: RELAY_PARTY });
		this.provider.on('custom-message', (raw: string) => {
			const notice = parsePersistenceNotice(raw);
			if (notice) this.notices.push(notice);
		});
	}

	static async join(host: string, room: string, doc?: Y.Doc): Promise<Peer> {
		const peer = new Peer(host, room, doc);
		await new Promise<void>((resolve) => {
			peer.provider.once('synced', () => resolve());
		});
		return peer;
	}

	/** Straight down the socket, as a client that isn't Yjs would send it. */
	sendRaw(update: Uint8Array): void {
		const messageSync = 0;
		const messageUpdate = 2;
		this.provider.ws?.send(
			Uint8Array.from([messageSync, messageUpdate, ...varUint(update.length), ...update])
		);
	}

	entries(): string[] {
		return [...this.doc.getMap<unknown>('issues').keys()].sort();
	}

	leave(): void {
		this.provider.destroy();
	}
}

function varUint(value: number): number[] {
	const bytes: number[] = [];
	let rest = value;
	while (rest > 127) {
		bytes.push((rest % 128) | 128);
		rest = Math.floor(rest / 128);
	}
	bytes.push(rest);
	return bytes;
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function asBytes(value: unknown): Uint8Array {
	expect(value).toBeInstanceOf(Uint8Array);
	return value as Uint8Array;
}

const hex = (value: unknown): string => Buffer.from(asBytes(value)).toString('hex');

function entriesIn(stored: unknown): string[] {
	const doc = new Y.Doc();
	Y.applyUpdate(doc, asBytes(stored));
	return [...doc.getMap<unknown>('issues').keys()].sort();
}

/** What any relay does on a first visit, so the tables exist and there is a row to damage. */
async function storedWorkspace(relay: OwnRelay, room: string): Promise<void> {
	const peer = await Peer.join(relay.host, room);
	peer.doc.getMap<unknown>('issues').set('kept', 'from an honest peer');
	await pause(SAVE_WINDOW_MS);
	peer.leave();
	await relay.stop();
	expect(entriesIn(relay.storage().snapshot)).toEqual(['kept']);
}

test('the 227-byte update never reaches the row, and the workspace survives a reload', async () => {
	const relay = new OwnRelay();
	const room = freshRoom();
	try {
		await relay.start();
		const first = await Peer.join(relay.host, room);
		first.doc.getMap<unknown>('issues').set('kept', 'from an honest peer');
		first.sendRaw(UNRELOADABLE_BASE);
		await pause(SAVE_WINDOW_MS);
		first.leave();
		await relay.stop();
		const before = asBytes(relay.storage().snapshot);
		expect(entriesIn(before)).toEqual(['kept', 'r1', 'sd']);

		await relay.start();
		const attacker = await Peer.join(relay.host, room);
		attacker.sendRaw(UNRELOADABLE_UPDATE);
		await expect.soft
			.poll(() => attacker.notices.map(({ state, reason }) => ({ state, reason })), {
				timeout: SAVE_WINDOW_MS
			})
			.toEqual([{ state: 'degraded', reason: 'unknown' }]);
		const announcedAt = attacker.notices[0]?.at;
		await pause(SAVE_WINDOW_MS);
		attacker.leave();
		await relay.stop();

		const stored = relay.storage();
		expect.soft(hex(stored.snapshot)).toEqual(hex(before));
		expect.soft(stored.quarantine).toBeUndefined();
		expect.soft(stored.health).toMatchObject({ state: 'degraded', reason: 'unreadable' });
		expect.soft(relay.lines('degraded')).toHaveLength(1);
		expect.soft(relay.lines('degraded')[0]).not.toContain(room);

		// Nothing in memory now: all of this comes back from the file.
		await relay.start();
		const later = await Peer.join(relay.host, room);
		await expect.soft.poll(() => later.entries()).toEqual(['kept', 'r1', 'sd']);
		// Still told, and told about the same failure, so a banner they dismissed stays dismissed.
		await expect.soft.poll(() => later.notices.at(-1)?.at).toBe(announcedAt);

		// No client sent the update again, so the next honest write saves and clears the state.
		later.doc.getMap<unknown>('issues').set('after', 'an honest edit');
		await expect.soft
			.poll(() => later.notices.at(-1)?.state, { timeout: SAVE_WINDOW_MS })
			.toBe('ok');
		later.leave();
		await relay.stop();
		expect.soft(entriesIn(relay.storage().snapshot)).toEqual(['after', 'kept', 'r1', 'sd']);
		expect.soft(relay.storage().health).toMatchObject({ state: 'ok' });
	} finally {
		await relay.dispose();
	}
});

test('a damaged row goes into quarantine, once, and the room is re-seeded from a client', async () => {
	const relay = new OwnRelay();
	const room = freshRoom();
	const damaged = Uint8Array.from([1, 2, 3, 4, 5]);
	try {
		await relay.start();
		const client = await Peer.join(relay.host, room);
		client.doc.getMap<unknown>('issues').set('kept', 'from an honest peer');
		await pause(SAVE_WINDOW_MS);
		client.leave();
		await relay.stop();

		const database = relay.database();
		database.prepare('UPDATE ydoc_snapshot SET doc = ? WHERE id = 1').run(damaged);
		database.close();

		// A first wake: it starts, empty, and says so.
		await relay.start();
		const stranger = await Peer.join(relay.host, room);
		await expect.poll(() => stranger.notices.length).toBe(1);
		expect(stranger.notices[0]).toMatchObject({ state: 'degraded', reason: 'unknown' });
		expect(stranger.entries()).toEqual([]);
		const announcedAt = stranger.notices[0]?.at;
		await expect.poll(() => relay.lines('quarantined').length).toBe(1);
		stranger.leave();
		await relay.stop();

		const moved = relay.storage();
		expect(hex(moved.quarantine)).toEqual(hex(damaged));
		expect(moved.snapshot).toBeUndefined();
		expect(moved.health).toMatchObject({ state: 'degraded', reason: 'unreadable' });
		expect(relay.lines('quarantined')[0]).not.toContain(room);

		// A second wake learns nothing new: no line, and the same `at`.
		await relay.start();
		const second = await Peer.join(relay.host, room);
		await expect.poll(() => second.notices.at(-1)?.at).toBe(announcedAt);
		// Logs reach wrangler a moment after they happen, and this is waiting for one not to.
		await pause(2_000);
		second.leave();
		await relay.stop();
		expect(relay.lines('quarantined')).toHaveLength(1);

		// The client still holds the document in its own copy, and re-seeding is all it takes.
		await relay.start();
		const returning = await Peer.join(relay.host, room, client.doc);
		await expect
			.poll(() => returning.notices.at(-1)?.state, { timeout: SAVE_WINDOW_MS })
			.toBe('ok');
		returning.leave();
		await relay.stop();

		const reseeded = relay.storage();
		expect(entriesIn(reseeded.snapshot)).toEqual(['kept']);
		expect(reseeded.health).toMatchObject({ state: 'ok' });
		// Recovery does not spend the evidence.
		expect(hex(reseeded.quarantine)).toEqual(hex(damaged));

		await relay.start();
		const afterwards = await Peer.join(relay.host, room);
		await expect.poll(() => afterwards.entries()).toEqual(['kept']);
		expect(afterwards.notices).toEqual([]);
		afterwards.leave();
	} finally {
		await relay.dispose();
	}
});

test('a stored value that is not bytes at all is kept as it was', async () => {
	const relay = new OwnRelay();
	try {
		const room = freshRoom();
		await relay.start();
		await storedWorkspace(relay, room);
		const database = relay.database();
		database.prepare(`UPDATE ydoc_snapshot SET doc = 'not bytes' WHERE id = 1`).run();
		database.close();

		await relay.start();
		const stranger = await Peer.join(relay.host, room);
		await expect.poll(() => stranger.notices.length).toBe(1);
		stranger.leave();
		await relay.stop();
		expect(relay.storage().quarantine).toBe('not bytes');
		expect(relay.storage().snapshot).toBeUndefined();
	} finally {
		await relay.dispose();
	}
});

test('with the quarantine already taken, the first copy stays and so does the later one', async () => {
	const relay = new OwnRelay();
	const firstCopy = Uint8Array.from([9, 9, 9]);
	const laterCopy = Uint8Array.from([1, 2, 3]);
	try {
		const room = freshRoom();
		await relay.start();
		await storedWorkspace(relay, room);
		// A wake with a damaged row creates the table, and the row it leaves is the first copy.
		let database = relay.database();
		database.prepare('UPDATE ydoc_snapshot SET doc = ? WHERE id = 1').run(firstCopy);
		database.close();
		await relay.start();
		const opener = await Peer.join(relay.host, room);
		await expect.poll(() => opener.notices.length).toBe(1);
		// And a client re-seeds it, so the room is healthy again when the second one turns up.
		opener.doc.getMap<unknown>('issues').set('kept', 'from an honest peer');
		await expect.poll(() => opener.notices.at(-1)?.state, { timeout: SAVE_WINDOW_MS }).toBe('ok');
		opener.leave();
		await relay.stop();
		expect(hex(relay.storage().quarantine)).toEqual(hex(firstCopy));

		database = relay.database();
		database.prepare('INSERT OR REPLACE INTO ydoc_snapshot (id, doc) VALUES (1, ?)').run(laterCopy);
		database.close();

		await relay.start();
		const peer = await Peer.join(relay.host, room);
		peer.doc.getMap<unknown>('issues').set('written', 'while it cannot be stored');
		await pause(SAVE_WINDOW_MS);
		expect(peer.notices.at(-1)).toMatchObject({ state: 'degraded', reason: 'unknown' });
		peer.leave();
		await relay.stop();

		const stored = relay.storage();
		expect(hex(stored.quarantine)).toEqual(hex(firstCopy));
		expect(hex(stored.snapshot)).toEqual(hex(laterCopy));
		expect(relay.lines('quarantine-failed').join('')).toContain('reason=occupied');
	} finally {
		await relay.dispose();
	}
});

test('when the quarantine cannot be written, saves are refused and the row survives', async () => {
	const relay = new OwnRelay();
	const damaged = Uint8Array.from([1, 2, 3]);
	try {
		const room = freshRoom();
		await relay.start();
		await storedWorkspace(relay, room);
		// A real write failing inside real workerd: the table's CHECK refuses every row.
		const database = relay.database();
		database.exec('DROP TABLE IF EXISTS ydoc_quarantine');
		database.exec(
			'CREATE TABLE ydoc_quarantine (id INTEGER PRIMARY KEY, doc BLOB NOT NULL CHECK (0), at INTEGER NOT NULL, error TEXT)'
		);
		database.prepare('UPDATE ydoc_snapshot SET doc = ? WHERE id = 1').run(damaged);
		database.close();

		await relay.start();
		const peer = await Peer.join(relay.host, room);
		await expect.poll(() => peer.notices.length).toBe(1);
		expect(peer.notices[0]).toMatchObject({ state: 'degraded', reason: 'unknown' });
		peer.doc.getMap<unknown>('issues').set('written', 'while it cannot be stored');
		await pause(SAVE_WINDOW_MS);
		peer.leave();
		await relay.stop();

		const stored = relay.storage();
		expect(hex(stored.snapshot)).toEqual(hex(damaged));
		expect(stored.quarantine).toBeUndefined();
		expect(relay.lines('quarantine-failed').join('')).toContain('reason=write-failed');
	} finally {
		await relay.dispose();
	}
});

test('a room whose quarantine table cannot be created still starts, and keeps its row', async () => {
	const relay = new OwnRelay();
	const damaged = Uint8Array.from([1, 2, 3]);
	try {
		const room = freshRoom();
		await relay.start();
		await storedWorkspace(relay, room);
		// A room from before the table, whose first CREATE of it fails for real inside real workerd:
		// an index holding the name is the one thing IF NOT EXISTS does not step around.
		let database = relay.database();
		database.exec('DROP TABLE IF EXISTS ydoc_quarantine');
		database.exec('CREATE INDEX ydoc_quarantine ON ydoc_snapshot (id)');
		database.close();

		await relay.start();
		const visitor = new Peer(relay.host, room);
		await expect.poll(() => visitor.entries(), { timeout: 15_000 }).toEqual(['kept']);
		await expect.poll(() => relay.lines('quarantine-table-failed').length).toBe(1);
		expect(relay.lines('quarantine-table-failed')[0]).not.toContain(room);
		// Nothing is wrong with the room, and its saves still land.
		visitor.doc.getMap<unknown>('issues').set('after', 'an honest edit');
		await pause(SAVE_WINDOW_MS);
		expect(visitor.notices).toEqual([]);
		visitor.leave();
		await relay.stop();
		expect(entriesIn(relay.storage().snapshot)).toEqual(['after', 'kept']);

		// Without the table a damaged row has nowhere to go, so it stays and saves are refused.
		database = relay.database();
		database.prepare('UPDATE ydoc_snapshot SET doc = ? WHERE id = 1').run(damaged);
		database.close();
		await relay.start();
		const peer = new Peer(relay.host, room);
		await expect
			.poll(() => peer.notices.at(-1), { timeout: 15_000 })
			.toMatchObject({ state: 'degraded', reason: 'unknown' });
		peer.doc.getMap<unknown>('issues').set('written', 'while it cannot be stored');
		await pause(SAVE_WINDOW_MS);
		peer.leave();
		await relay.stop();
		expect(hex(relay.storage().snapshot)).toEqual(hex(damaged));
		expect(relay.lines('quarantine-failed').join('')).toContain('reason=write-failed');
	} finally {
		await relay.dispose();
	}
});

async function openSynced(page: Page): Promise<void> {
	await page.goto('/issues');
	await expect(page.getByTestId('relay-status')).toHaveAttribute('data-synced', 'true', {
		timeout: 30_000
	});
}

test('a refused save reaches the page through the banner that is already there', async ({
	page,
	workspaceId
}) => {
	const errors: Error[] = [];
	page.on('pageerror', (error) => errors.push(error));
	await openSynced(page);

	const attacker = await Peer.join(SUITE_RELAY_HOST, workspaceId);
	attacker.sendRaw(UNRELOADABLE_BASE);
	attacker.sendRaw(UNRELOADABLE_UPDATE);

	await expect(page.getByText('This workspace has stopped saving on the server')).toBeVisible({
		timeout: 15_000
	});
	await expect(page.getByTestId('relay-status')).toHaveAttribute('data-persistence', 'degraded');
	attacker.leave();
	expect(errors).toEqual([]);
});
