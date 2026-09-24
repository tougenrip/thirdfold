// The sounds a motion makes (a lever's clank, a chain's rattle, a grate
// grinding open), synthesized with Web Audio: no files to load. A stand-in
// until thirdfold has real audio. Presentation only; the browser keeps the
// audio context suspended until the page has been interacted with, and then
// these just don't play.

import type { Sound } from '$lib/game/motion';

const VOLUME = 0.22;

let context: AudioContext | null = null;
let noise: AudioBuffer | null = null;

function audio(): AudioContext | null {
	try {
		context ??= new AudioContext();
	} catch {
		return null;
	}
	if (context.state === 'suspended') void context.resume().catch(() => {});
	return context;
}

function noiseBuffer(ctx: AudioContext): AudioBuffer {
	if (noise) return noise;
	noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
	const data = noise.getChannelData(0);
	for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
	return noise;
}

/** A gain that rises fast to `peak` at `at` and dies away over `length` seconds. */
function envelope(ctx: AudioContext, at: number, length: number, peak: number): GainNode {
	const gain = ctx.createGain();
	gain.gain.setValueAtTime(0.0001, at);
	gain.gain.exponentialRampToValueAtTime(peak * VOLUME, at + 0.01);
	gain.gain.exponentialRampToValueAtTime(0.0001, at + length);
	gain.connect(ctx.destination);
	return gain;
}

/** Filtered noise: scrapes, cracks, rattles, the grind of iron. */
function hiss(
	ctx: AudioContext,
	at: number,
	length: number,
	peak: number,
	filter: BiquadFilterType,
	frequency: number,
	sweepTo?: number
): void {
	const source = ctx.createBufferSource();
	source.buffer = noiseBuffer(ctx);
	const band = ctx.createBiquadFilter();
	band.type = filter;
	band.frequency.setValueAtTime(frequency, at);
	if (sweepTo) band.frequency.exponentialRampToValueAtTime(sweepTo, at + length);
	band.Q.value = 1.2;
	source.connect(band).connect(envelope(ctx, at, length, peak));
	source.start(at, Math.random());
	source.stop(at + length + 0.05);
}

/** A pitched note, optionally sliding: clanks, thuds, chimes. */
function tone(
	ctx: AudioContext,
	at: number,
	length: number,
	peak: number,
	type: OscillatorType,
	frequency: number,
	slideTo?: number
): void {
	const osc = ctx.createOscillator();
	osc.type = type;
	osc.frequency.setValueAtTime(frequency, at);
	if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, at + length);
	osc.connect(envelope(ctx, at, length, peak));
	osc.start(at);
	osc.stop(at + length + 0.05);
}

export function playSound(sound: Sound): void {
	const ctx = audio();
	if (!ctx) return;
	const now = ctx.currentTime;
	switch (sound) {
		case 'clank':
			tone(ctx, now, 0.35, 0.5, 'square', 190, 120);
			hiss(ctx, now, 0.08, 0.6, 'highpass', 2500);
			return;
		case 'rattle':
			for (let i = 0; i < 7; i++) hiss(ctx, now + i * 0.07, 0.06, 0.5, 'bandpass', 2800 + i * 90);
			return;
		case 'grind':
			hiss(ctx, now, 1.3, 0.7, 'lowpass', 500, 180);
			tone(ctx, now, 1.3, 0.25, 'sawtooth', 58, 44);
			return;
		case 'chime':
			tone(ctx, now, 1.6, 0.45, 'sine', 1320);
			tone(ctx, now, 1.1, 0.2, 'sine', 2640);
			return;
		case 'crack':
			hiss(ctx, now, 0.18, 0.9, 'bandpass', 1500);
			tone(ctx, now, 0.12, 0.4, 'triangle', 220, 90);
			return;
		case 'scrape':
			hiss(ctx, now, 0.55, 0.5, 'bandpass', 900, 600);
			return;
		case 'thud':
			tone(ctx, now, 0.3, 0.7, 'sine', 95, 48);
			return;
	}
}
