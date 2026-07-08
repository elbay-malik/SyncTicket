import { page } from 'vitest/browser';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import ThemeToggle from './theme-toggle.svelte';

describe('theme-toggle.svelte', () => {
	it('renders the trigger and opens the mode menu', async () => {
		render(ThemeToggle);

		const trigger = page.getByRole('button', { name: 'Toggle theme' });
		await expect.element(trigger).toBeInTheDocument();

		await trigger.click();
		await expect.element(page.getByRole('menuitem', { name: 'Light' })).toBeInTheDocument();
		await expect.element(page.getByRole('menuitem', { name: 'Dark' })).toBeInTheDocument();
		await expect.element(page.getByRole('menuitem', { name: 'System' })).toBeInTheDocument();
	});
});
