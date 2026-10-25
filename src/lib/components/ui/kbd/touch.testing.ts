// Test support, shared by the Kbd test and the shortcuts sheet's: which elements the app's
// stylesheet hides on a touch-only device.
//
// The pointer media features cannot be emulated per test (Playwright sets them only through a
// whole context's `hasTouch`), so callers assert one level down, on the generated CSS: find
// every `display: none` rule inside a `(pointer: coarse) and (hover: none)` block and ask
// whether an element matches it. The caller must have imported `routes/layout.css`, or there
// is nothing for Tailwind to have generated into.

/** Selectors of every `display: none` rule that applies only on a touch-only device. */
export function touchHiddenSelectors(): string[] {
	const found: string[] = [];
	// `selector` is the nearest enclosing style rule's: Tailwind v4 emits a variant as the
	// utility's own rule with the media block NESTED inside it, and the declaration inside that
	// block is a selector-less CSSNestedDeclarations that inherits it.
	const walk = (rules: CSSRuleList, touch: boolean, selector: string) => {
		for (const rule of rules) {
			if (rule instanceof CSSMediaRule) {
				const text = rule.conditionText;
				const coarse = /pointer:\s*coarse/.test(text) && /hover:\s*none/.test(text);
				walk(rule.cssRules, touch || coarse, selector);
			} else if (rule instanceof CSSStyleRule) {
				if (touch && rule.style.display === 'none') found.push(rule.selectorText);
				walk(rule.cssRules, touch, rule.selectorText);
			} else if (
				typeof CSSNestedDeclarations !== 'undefined' &&
				rule instanceof CSSNestedDeclarations
			) {
				if (touch && selector && rule.style.display === 'none') found.push(selector);
			} else if ('cssRules' in rule) {
				// @layer, @supports and the like: transparent to the question.
				walk((rule as CSSGroupingRule).cssRules, touch, selector);
			}
		}
	};
	for (const sheet of document.styleSheets) walk(sheet.cssRules, false, '');
	return found;
}

/** Whether `element` would be `display: none` on a phone. */
export function hiddenOnTouch(element: Element): boolean {
	return touchHiddenSelectors().some((selector) => element.matches(selector));
}
