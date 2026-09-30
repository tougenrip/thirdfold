// PNG for textures: encoding what the pipeline generates (8-bit RGBA, no
// filtering tricks), reading the size of a PNG an author provides, and
// decoding an artist's texture for the cook (cook-textures.ts).

import { deflateSync, inflateSync } from 'node:zlib';

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

/**
 * An RGBA image (`width * height * 4` bytes, row by row) as a PNG. `sub` stores each byte as its
 * difference from the pixel to its left (PNG filter 1): smooth gradients (colour grades) then
 * compress to a fraction.
 */
export function encodePng(
	width: number,
	height: number,
	rgba: Uint8Array,
	filter: 'none' | 'sub' = 'none'
): Buffer {
	if (rgba.length !== width * height * 4) throw new Error('encodePng: wrong pixel count');
	const header = Buffer.alloc(13);
	header.writeUInt32BE(width, 0);
	header.writeUInt32BE(height, 4);
	header[8] = 8; // bits per channel
	header[9] = 6; // RGBA
	// Each row starts with its filter type: 0, none, or 1, sub.
	const raw = Buffer.alloc((width * 4 + 1) * height);
	for (let y = 0; y < height; y++) {
		const row = y * (width * 4 + 1);
		raw[row] = filter === 'sub' ? 1 : 0;
		for (let i = 0; i < width * 4; i++) {
			const v = rgba[y * width * 4 + i];
			raw[row + 1 + i] = filter === 'sub' && i >= 4 ? (v - rgba[y * width * 4 + i - 4]) & 255 : v;
		}
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

/** Channels per colour type the decoder reads: grey, RGB, grey and alpha, RGBA. */
const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 4: 2, 6: 4 };

/**
 * A PNG as RGBA, 8 bits a channel: grey, grey and alpha, RGB or RGBA, 8 or 16 bits a channel (a
 * scan's height or normal map; a 16-bit sample's high byte kept). Refuses anything else
 * (palettes, interlacing, other depths), so an artist exports one of these.
 */
export function decodePng(data: Uint8Array): { width: number; height: number; data: Uint8Array } {
	const png = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
	const size = pngSize(png);
	if (!size) throw new Error('not a PNG');
	const { width, height } = size;
	const [depth, type, , , interlace] = png.subarray(24, 29);
	const channels = CHANNELS[type];
	if (!channels || !(depth === 8 || depth === 16) || interlace !== 0) {
		throw new Error('export 8- or 16-bit grey, RGB or RGBA, not interlaced');
	}
	if (width < 1 || height < 1 || width > 8192 || height > 8192) throw new Error('bad PNG size');
	const idat: Buffer[] = [];
	for (let at = 8; at + 8 <= png.length;) {
		const length = png.readUInt32BE(at);
		const kind = png.subarray(at + 4, at + 8).toString('ascii');
		if (kind === 'IDAT') idat.push(png.subarray(at + 8, at + 8 + length));
		if (kind === 'IEND') break;
		at += 12 + length;
	}
	const bpp = (channels * depth) / 8;
	const stride = width * bpp;
	const expected = (stride + 1) * height;
	const raw = inflateSync(Buffer.concat(idat), { maxOutputLength: expected });
	if (raw.length !== expected) throw new Error('PNG data does not match its size');

	// Undo each row's filter (none, sub, up, average, Paeth).
	const pixels = new Uint8Array(stride * height);
	for (let y = 0; y < height; y++) {
		const filter = raw[y * (stride + 1)];
		const row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
		const out = y * stride;
		for (let i = 0; i < stride; i++) {
			const a = i >= bpp ? pixels[out + i - bpp] : 0;
			const b = y > 0 ? pixels[out + i - stride] : 0;
			const c = i >= bpp && y > 0 ? pixels[out + i - stride - bpp] : 0;
			let v: number;
			if (filter === 0) v = 0;
			else if (filter === 1) v = a;
			else if (filter === 2) v = b;
			else if (filter === 3) v = (a + b) >> 1;
			else if (filter === 4) {
				const p = a + b - c;
				const [pa, pb, pc] = [Math.abs(p - a), Math.abs(p - b), Math.abs(p - c)];
				v = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
			} else throw new Error(`bad PNG filter ${filter}`);
			pixels[out + i] = (row[i] + v) & 255;
		}
	}

	const rgba = new Uint8Array(width * height * 4);
	const grey = channels < 3;
	for (let i = 0; i < width * height; i++) {
		// A channel's byte: the high byte of a 16-bit sample.
		const at = (k: number) => pixels[i * bpp + (k * depth) / 8];
		rgba[i * 4] = at(0);
		rgba[i * 4 + 1] = grey ? at(0) : at(1);
		rgba[i * 4 + 2] = grey ? at(0) : at(2);
		rgba[i * 4 + 3] = channels === 2 ? at(1) : channels === 4 ? at(3) : 255;
	}
	return { width, height, data: rgba };
}
