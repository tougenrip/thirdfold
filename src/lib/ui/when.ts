// "Last played" times, the way people say them: today, yesterday, or the date.

const time = (d: Date, locale?: string) =>
	d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });

const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/** e.g. "Today 21:43", "Yesterday 21:43", "12 Sept 21:43" (in the viewer's time zone). */
export function lastPlayed(iso: string, now = new Date(), locale?: string): string {
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return '';
	const days = Math.round((dayStart(now) - dayStart(d)) / 86_400_000);
	if (days === 0) return `Today ${time(d, locale)}`;
	if (days === 1) return `Yesterday ${time(d, locale)}`;
	const date = d.toLocaleDateString(locale, {
		day: 'numeric',
		month: 'short',
		...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {})
	});
	return `${date} ${time(d, locale)}`;
}
