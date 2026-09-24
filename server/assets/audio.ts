// Sound files: WAV that the pipeline renders (16-bit mono), and reading the
// format and length of a WAV or Ogg (Vorbis or Opus) file an author provides.
// Rendering: The Hollow Bell's bells, from the same partials the audio
// engine plays live (src/lib/audio/bell.ts), so a rendered bell and a
// synthesized one are the same bell.

import { BELLS, bellPartials, type BellSize } from '../../src/lib/audio/bell';

/** A mono signal (-1..1) as a 16-bit PCM WAV. */
export function encodeWav(samples: Float32Array, rate: number): Buffer {
	const data = Buffer.alloc(samples.length * 2);
	for (let i = 0; i < samples.length; i++) {
		data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), i * 2);
	}
	const header = Buffer.alloc(44);
	header.write('RIFF', 0, 'ascii');
	header.writeUInt32LE(36 + data.length, 4);
	header.write('WAVE', 8, 'ascii');
	header.write('fmt ', 12, 'ascii');
	header.writeUInt32LE(16, 16);
	header.writeUInt16LE(1, 20); // PCM
	header.writeUInt16LE(1, 22); // mono
	header.writeUInt32LE(rate, 24);
	header.writeUInt32LE(rate * 2, 28);
	header.writeUInt16LE(2, 32);
	header.writeUInt16LE(16, 34);
	header.write('data', 36, 'ascii');
	header.writeUInt32LE(data.length, 40);
	return Buffer.concat([header, data]);
}

export interface AudioInfo {
	format: 'wav' | 'ogg';
	/** Seconds. */
	duration: number;
}

/** What kind of sound file `data` is, and how long it plays; null if it is neither WAV nor Ogg. */
export function audioInfo(data: Buffer): AudioInfo | null {
	if (
		data.length >= 12 &&
		data.toString('ascii', 0, 4) === 'RIFF' &&
		data.toString('ascii', 8, 12) === 'WAVE'
	) {
		return wavInfo(data);
	}
	if (data.length >= 28 && data.toString('ascii', 0, 4) === 'OggS') return oggInfo(data);
	return null;
}

function wavInfo(data: Buffer): AudioInfo | null {
	let offset = 12;
	let byteRate = 0;
	let format = 0;
	while (offset + 8 <= data.length) {
		const id = data.toString('ascii', offset, offset + 4);
		const size = data.readUInt32LE(offset + 4);
		if (id === 'fmt ' && offset + 24 <= data.length) {
			format = data.readUInt16LE(offset + 8);
			byteRate = data.readUInt32LE(offset + 16);
		}
		if (id === 'data') {
			// PCM (1) or float (3) only: nothing a browser would have to guess at.
			if ((format !== 1 && format !== 3) || byteRate <= 0) return null;
			return { format: 'wav', duration: Math.min(size, data.length - offset - 8) / byteRate };
		}
		offset += 8 + size + (size & 1);
	}
	return null;
}

function oggInfo(data: Buffer): AudioInfo | null {
	// The first page holds the codec's identification header: its sample rate.
	const segments = data[26];
	const body = 27 + segments;
	let rate = 0;
	if (data.toString('ascii', body + 1, body + 7) === 'vorbis' && data[body] === 1) {
		rate = data.readUInt32LE(body + 12);
	} else if (data.toString('ascii', body, body + 8) === 'OpusHead') {
		rate = 48000;
	}
	if (!rate) return null;
	// The last page's granule position is the number of samples in the stream.
	const last = data.lastIndexOf('OggS');
	if (last < 0 || last + 14 > data.length) return null;
	const granule = Number(data.readBigUInt64LE(last + 6));
	return { format: 'ogg', duration: granule / rate };
}

/** A bell of The Hollow Bell's family, struck once and left to ring, as samples at `rate`. */
export function renderBell(size: BellSize, rate: number, seconds?: number): Float32Array {
	const bell = BELLS[size];
	const length = Math.ceil((seconds ?? bell.ring) * rate);
	const out = new Float32Array(length);
	for (const p of bellPartials(bell.note, bell.ring)) {
		// Each partial strikes at once and dies away over its own length, as the engine's
		// envelope does (down to a ten-thousandth); a hint of beating (two slightly detuned
		// strands) makes it sound cast, not electronic.
		const tau = p.length / Math.log(1e4);
		for (const detune of [0.9985, 1.0015]) {
			const w = (2 * Math.PI * p.freq * detune) / rate;
			for (let i = 0; i < length; i++) {
				const t = i / rate;
				const attack = Math.min(1, t / 0.004);
				out[i] += (p.gain / 2) * attack * Math.exp(-t / tau) * Math.sin(w * i);
			}
		}
	}
	let peak = 0;
	for (const v of out) peak = Math.max(peak, Math.abs(v));
	const scale = peak > 0 ? (0.9 * bell.gain) / peak : 0;
	for (let i = 0; i < length; i++) out[i] *= scale;
	return out;
}
