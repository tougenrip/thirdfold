// PNG for textures: encoding what the pipeline generates (8-bit RGBA, no
// filtering tricks) and reading the size of a PNG an author provides.

import { deflateSync } from 'node:zlib';

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE = (() => {
	const table = new Uint32Array(256);
	for (let n = 0; n < 256; n++) {
		let c = n;
		for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		table[n] = c >>> 0;
	}
	return table;
})();

function crc32(bytes: Buffer): number {
	let c = 0xffffffff;
	for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
	return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
	const length = Buffer.alloc(4);
	length.writeUInt32BE(data.length);
	const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE(crc32(body));
	return Buffer.concat([length, body, crc]);
}

/** An RGBA image (`width * height * 4` bytes, row by row) as a PNG. */
export function encodePng(width: number, height: number, rgba: Uint8Array): Buffer {
	if (rgba.length !== width * height * 4) throw new Error('encodePng: wrong pixel count');
	const header = Buffer.alloc(13);
	header.writeUInt32BE(width, 0);
	header.writeUInt32BE(height, 4);
	header[8] = 8; // bits per channel
	header[9] = 6; // RGBA
	// Each row starts with its filter type: 0, none.
	const raw = Buffer.alloc((width * 4 + 1) * height);
	for (let y = 0; y < height; y++) {
		raw[y * (width * 4 + 1)] = 0;
		Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4).copy(
			raw,
			y * (width * 4 + 1) + 1
		);
	}
	return Buffer.concat([
		SIGNATURE,
		chunk('IHDR', header),
		chunk('IDAT', deflateSync(raw, { level: 9 })),
		chunk('IEND', Buffer.alloc(0))
	]);
}

/** A PNG's size, or null if `data` is not a PNG. */
export function pngSize(data: Buffer): { width: number; height: number } | null {
	if (data.length < 33 || !data.subarray(0, 8).equals(SIGNATURE)) return null;
	if (data.subarray(12, 16).toString('ascii') !== 'IHDR') return null;
	return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
}
