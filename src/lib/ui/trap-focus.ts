const FOCUSABLE =
	'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

/**
 * Keeps Tab inside a modal dialog while it is open, and hands focus back to
 * whatever had it when the dialog closes.
 */
export function trapFocus(node: HTMLElement) {
	const before = document.activeElement as HTMLElement | null;

	function onKeydown(event: KeyboardEvent) {
		if (event.key !== 'Tab') return;
		const items = [...node.querySelectorAll<HTMLElement>(FOCUSABLE)];
		if (items.length === 0) return;
		const first = items[0];
		const last = items[items.length - 1];
		const active = document.activeElement;
		if (event.shiftKey && (active === first || !node.contains(active))) {
			event.preventDefault();
			last.focus();
		} else if (!event.shiftKey && (active === last || !node.contains(active))) {
			event.preventDefault();
			first.focus();
		}
	}

	node.addEventListener('keydown', onKeydown);
	if (!node.contains(document.activeElement)) {
		node.querySelector<HTMLElement>(FOCUSABLE)?.focus();
	}
	return {
		destroy() {
			node.removeEventListener('keydown', onKeydown);
			if (before?.isConnected) before.focus();
		}
	};
}
