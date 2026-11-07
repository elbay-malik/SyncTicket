// Where a card dragged with a pointer can be released, against the real library.
//
// The demo test found two silent snap-backs. A column only accepted a drop where its cards
// were, so releasing a card in the lower part of a column, or anywhere in an empty one but
// the top, sent it back to where it came from. And on a phone the next column only shows at
// the screen's edge, in a strip that belonged to no column, so the natural gesture of
// dragging a card towards it failed too. The library also judged the drop by the dragged
// card's centre rather than the pointer, so where the card was held changed where it landed.
//
// The keyboard tests in board.e2e.ts cover moves exactly. These drive a real mouse, slowly
// enough for the library's 200 ms drop-zone polling to see each position.

import { expect, onRoute, test, type Page } from './fixtures.js';

async function seed(page: Page, titles: string[]) {
	await page.goto('/issues');
	await expect(page.getByText('No issues yet')).toBeVisible();
	for (const title of titles) {
		const input = page.getByPlaceholder('Add an issue…');
		await input.fill(title);
		await input.press('Enter');
		await expect(page.getByRole('link', { name: title })).toBeVisible();
	}
	await page.getByRole('link', { name: 'Board' }).click();
	await expect(page).toHaveURL(onRoute('/board'));
	await expect(page.getByRole('list', { name: 'Backlog' })).toBeVisible();
}

const column = (page: Page, name: string) => page.getByRole('list', { name });

/** Presses at `from`, glides to `to` in small steps, waits out the polling, releases. */
async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
	await page.mouse.move(from.x, from.y);
	await page.mouse.down();
	const steps = 20;
	for (let i = 1; i <= steps; i++) {
		await page.mouse.move(
			from.x + ((to.x - from.x) * i) / steps,
			from.y + ((to.y - from.y) * i) / steps
		);
		await page.waitForTimeout(25);
	}
	await page.waitForTimeout(450);
	await page.mouse.up();
	// The library animates the drop before it reports it.
	await page.waitForTimeout(400);
}

/** The column's whole frame, header included: the <section> around the list. */
async function frame(page: Page, name: string) {
	const rect = await column(page, name).locator('xpath=ancestor::section[1]').boundingBox();
	if (!rect) throw new Error(`no frame for ${name}`);
	return rect;
}

test('a card released in the lower part of a column lands there', async ({ page }) => {
	await seed(page, ['Alpha', 'Bravo', 'Charlie', 'Delta']);
	const card = await column(page, 'Backlog').getByRole('listitem').first().boundingBox();
	const todo = await frame(page, 'Todo');
	expect(card).not.toBeNull();
	// Low in an empty column: below the old 128 px zone, inside the drawn frame.
	const target = { x: todo.x + todo.width / 2, y: todo.y + todo.height - 30 };
	expect(target.y - todo.y).toBeGreaterThan(200);
	await drag(page, { x: card!.x + card!.width / 2, y: card!.y + card!.height / 2 }, target);

	await expect(column(page, 'Todo').getByRole('listitem')).toHaveCount(1);
	await expect(column(page, 'Backlog').getByRole('listitem')).toHaveCount(3);
});

test('the pointer decides the column, wherever on the card it was held', async ({ page }) => {
	await seed(page, ['Alpha', 'Bravo']);
	const card = (await column(page, 'Backlog').getByRole('listitem').first().boundingBox())!;
	const todo = await frame(page, 'Todo');
	// Held near its right edge and released just inside Todo: the card's centre is still
	// over Backlog, which is what the library used to go by.
	const from = { x: card.x + card.width - 6, y: card.y + card.height / 2 };
	const to = { x: todo.x + 12, y: todo.y + 120 };
	expect(to.x - (card.width - 6) + card.width / 2).toBeLessThan(todo.x);
	await drag(page, from, to);

	await expect(column(page, 'Todo').getByRole('listitem')).toHaveCount(1);
});

test.describe('on a phone', () => {
	test('a card dragged to the screen edge, over the next column, leaves its own', async ({
		page
	}) => {
		await seed(page, ['Alpha', 'Bravo', 'Charlie']);
		// Seeded at desktop width, where the sidebar's Board link is showing; then a phone.
		await page.setViewportSize({ width: 390, height: 740 });
		await expect(page.getByRole('link', { name: 'Board' })).toBeHidden();
		const card = (await column(page, 'Backlog').getByRole('listitem').first().boundingBox())!;
		// The last few pixels of the screen, where only the next column shows. They used to be
		// padding outside the board's scroller, part of no column.
		const to = { x: 384, y: card.y + card.height / 2 + 60 };
		await drag(page, { x: card.x + card.width / 2, y: card.y + card.height / 2 }, to);

		await expect(column(page, 'Backlog').getByRole('listitem')).toHaveCount(2);
		await expect(page.getByTestId('board-drop-missed')).toBeEmpty();
	});
});

test('a card released outside every column goes back, and the board says why', async ({ page }) => {
	await seed(page, ['Alpha', 'Bravo']);
	const card = (await column(page, 'Backlog').getByRole('listitem').first().boundingBox())!;
	const title = (await page.getByRole('heading', { name: 'Board', level: 1 }).boundingBox())!;
	await drag(
		page,
		{ x: card.x + card.width / 2, y: card.y + card.height / 2 },
		{ x: title.x + title.width / 2, y: title.y + title.height / 2 }
	);

	await expect(column(page, 'Backlog').getByRole('listitem')).toHaveCount(2);
	await expect(page.getByTestId('board-drop-missed')).toContainText('outside every column');
});
