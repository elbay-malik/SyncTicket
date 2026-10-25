import { redirect } from '@sveltejs/kit';
import type { PageLoad } from './$types';

// The query string goes along: `/?ws=…` is a workspace link like any other, and dropping it
// here would land the visitor in a workspace of their own before the client ever read it.
export const load: PageLoad = ({ url }) => {
	redirect(307, `/issues${url.search}`);
};
