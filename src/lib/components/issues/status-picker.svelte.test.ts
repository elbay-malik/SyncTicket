// The picker is the inline-edit affordance used in both the list and the detail sheet, so
// its contract is: the trigger names the *current* value (a screen reader user must be able
// to read the status without opening the menu), and onchange fires only on a real change.

import { page, userEvent } from 'vitest/browser';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import StatusPicker from './status-picker.svelte';

describe('status-picker.svelte', () => {
	it('names the current status on the trigger and reports a new selection', async () => {
		const onchange = vi.fn();
		await render(StatusPicker, { value: 'backlog', onchange });

		const trigger = page.getByRole('button', { name: 'Status: Backlog' });
		await expect.element(trigger).toBeInTheDocument();

		await trigger.click();
		// bits-ui renders radio items, not plain menu items.
		await page.getByRole('menuitemradio', { name: 'Done' }).click();
		expect(onchange).toHaveBeenCalledWith('done');

		// closeOnSelect defaults to true, so the menu is gone from the DOM afterwards.
		await expect.element(page.getByRole('menu')).not.toBeInTheDocument();
	});

	it('does not fire onchange when the current value is re-selected', async () => {
		const onchange = vi.fn();
		await render(StatusPicker, { value: 'todo', onchange });

		await page.getByRole('button', { name: 'Status: Todo' }).click();
		await page.getByRole('menuitemradio', { name: 'Todo' }).click();
		expect(onchange).not.toHaveBeenCalled();
	});

	it('closes on Escape without selecting', async () => {
		const onchange = vi.fn();
		await render(StatusPicker, { value: 'backlog', onchange });

		await page.getByRole('button', { name: 'Status: Backlog' }).click();
		await expect.element(page.getByRole('menu')).toBeInTheDocument();

		await userEvent.keyboard('{Escape}');
		await expect.element(page.getByRole('menu')).not.toBeInTheDocument();
		expect(onchange).not.toHaveBeenCalled();
	});
});
