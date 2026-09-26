// The one source this catalog is imported from: the official System
// Reference Document 5.2.1, as Wizards of the Coast publishes it, pinned to
// the exact file in content/srd/5.2.1 by its SHA-256. Nothing else (no D&D
// Beyond Basic Rules, no other book) goes into this catalog.

import type { ContentSource } from '../../../../src/lib/content/catalog';
import { ATTRIBUTION } from '../core';

export const SRD_521: ContentSource = {
	id: 'srd-5.2.1',
	title: 'System Reference Document 5.2.1',
	version: '5.2.1',
	publisher: 'Wizards of the Coast LLC',
	url: 'https://www.dndbeyond.com/srd',
	file: 'content/srd/5.2.1/SRD_CC_v5.2.1.pdf',
	sha256: '8974902d109d6e63672d7c490bde9ccf052410503d9cfa768237154fbc5e3d87',
	license: {
		id: 'CC-BY-4.0',
		name: 'Creative Commons Attribution 4.0 International',
		url: 'https://creativecommons.org/licenses/by/4.0/legalcode'
	},
	attribution: ATTRIBUTION
};
