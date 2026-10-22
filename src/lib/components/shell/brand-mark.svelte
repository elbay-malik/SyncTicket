<script lang="ts">
	// The product mark: one document, two copies of it, and the value they agree on.
	//
	// It replaces a Lucide ZapIcon in the sidebar and the SvelteKit scaffold's Svelte logo in the
	// browser tab — the two places this product was presenting either a generic glyph or another
	// project's identity to the three evaluator audiences in PRODUCT.md.
	//
	// WHY A SOFT RECTANGLE AND NOT A RING, which is the obvious drawing of a sync mark and was
	// built first. This app ships six circle-family glyphs — circle, circle-dashed, circle-dot,
	// circle-dot-dashed, circle-check, circle-x — and five of them are the issue statuses, where
	// DESIGN.md's badges render icon-only so that "the icon is the information". A ring with a
	// centre dot is therefore not a free shape here: it is circle-dot-dashed, which already means
	// In Progress. The first build used exactly that figure and sat 70px from a live circle-dot
	// in the same sidebar. Identity had wandered into the semantic channel.
	//
	// So the mark takes the system's OTHER form language instead: the soft rectangle of its own
	// cards and panels. Split into two halves closing on one shared point, it says "two copies,
	// one agreed value" in a silhouette the status set cannot own — and it uses the radius
	// language, which nothing else in the identity was using.
	//
	// WHY IT IS GREY. DESIGN.md's Colour Means State Rule reserves every hue for status, and the
	// mark obeys it rather than claiming an exception. `currentColor` means it inherits
	// `--foreground`, so it needs no dark-mode variant, no token, and no second asset.
	//
	// GEOMETRY, so a later edit does not break it by eye: the box is x,y 4..20 with a 4.5 corner
	// radius, which reads as this product's card and not as a circle — at r=6 it rounds back
	// toward the status family. The seams are 2.6 either side of centre. The dot is r=2.7
	// because at 16px on a 1x display anything smaller renders as a 3px smudge, and the dot is
	// the element carrying the entire meaning. Every number here was chosen by rendering it at
	// 16/20/24/32 beside the glyphs it must not resemble, not by eye at 24px.

	let { class: className = 'size-4' }: { class?: string } = $props();
</script>

<svg
	class={className}
	viewBox="0 0 24 24"
	fill="none"
	stroke="currentColor"
	stroke-width="2"
	stroke-linecap="round"
	stroke-linejoin="round"
	aria-hidden="true"
>
	<path d="M9.4 4H8.5A4.5 4.5 0 0 0 4 8.5v7a4.5 4.5 0 0 0 4.5 4.5h0.9" />
	<path d="M14.6 4h0.9A4.5 4.5 0 0 1 20 8.5v7a4.5 4.5 0 0 1-4.5 4.5h-0.9" />
	<circle cx="12" cy="12" r="2.7" fill="currentColor" stroke="none" />
</svg>
