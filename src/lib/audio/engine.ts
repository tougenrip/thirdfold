// thirdfold's sound, synthesized with Web Audio: no files to fetch. Four
// buses (music, ambience, effects, and the effects' share of a shared
// reverb) under a master gain set from the player's mix. Everything here is
// presentation: it plays what cues.ts derived from the synced state and
// never touches the game. Browsers only allow audio after the page has been
// interacted with, so nothing is created until `unlock()` (on the first
// click or key press); until then every call is a no-op.

import type { Sound } from '../game/motion';
import { BELLS, bellPartials, type BellSize } from './bell';
import type { Ambience, AudioEvent, MusicState, Surface } from './cues';
import { busGain, DEFAULT_MIX, type Mix } from './mix';

type Bus = 'music' | 'ambience' | 'effects';

interface Graph {
	ctx: AudioContext;
	master: GainNode;
	buses: Record<Bus, GainNode>;
	/** Shared reverb: send a voice here as well as to its bus for space. */
	reverb: GainNode;
	noise: AudioBuffer;
}

let graph: Graph | null = null;
let mix: Mix = { ...DEFAULT_MIX };
let wantedMusic: MusicState = { mood: 'none', intensity: 0, ending: null };
let wantedAmbience: Ambience | null = null;

/** Creates the audio graph (call from a user gesture); later calls just resume it. */
export function unlock(): void {
	if (graph) {
		if (graph.ctx.state === 'suspended') void graph.ctx.resume().catch(() => {});
		return;
	}
	let ctx: AudioContext;
	try {
		ctx = new AudioContext();
	} catch {
		return;
	}
	const master = ctx.createGain();
	master.connect(ctx.destination);
	const buses = {
		music: ctx.createGain(),
		ambience: ctx.createGain(),
		effects: ctx.createGain()
	};
	for (const bus of Object.values(buses)) bus.connect(master);
	const convolver = ctx.createConvolver();
	convolver.buffer = impulse(ctx, 3.2);
	const reverb = ctx.createGain();
	reverb.gain.value = 0.5;
	reverb.connect(convolver).connect(buses.effects);
	graph = { ctx, master, buses, reverb, noise: noiseBuffer(ctx) };
	applyMix();
	setAmbience(wantedAmbience);
	startConductor();
}

export function setMix(next: Mix): void {
	mix = next;
	applyMix();
}

function applyMix(): void {
	if (!graph) return;
	const now = graph.ctx.currentTime;
	for (const bus of ['music', 'ambience', 'effects'] as const) {
		graph.buses[bus].gain.setTargetAtTime(busGain(mix, bus), now, 0.1);
	}
}

// ---------------------------------------------------------------------------
// Voices

function noiseBuffer(ctx: AudioContext): AudioBuffer {
	const buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
	const data = buffer.getChannelData(0);
	for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
	return buffer;
}

/** A decaying noise tail: a stone room's reverb, made once. */
function impulse(ctx: AudioContext, seconds: number): AudioBuffer {
	const length = Math.floor(ctx.sampleRate * seconds);
	const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
	for (let ch = 0; ch < 2; ch++) {
		const data = buffer.getChannelData(ch);
		for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length) ** 3;
	}
	return buffer;
}

/** A gain that rises over `attack` to `peak` at `at` and dies away by `at + length`. */
function envelope(
	g: Graph,
	at: number,
	length: number,
	peak: number,
	to: AudioNode,
	attack = 0.008
): GainNode {
	const gain = g.ctx.createGain();
	gain.gain.setValueAtTime(0.0001, at);
	gain.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), at + attack);
	gain.gain.exponentialRampToValueAtTime(0.0001, at + Math.max(length, attack + 0.01));
	gain.connect(to);
	return gain;
}

/** A pitched note, optionally sliding. */
function tone(
	g: Graph,
	at: number,
	length: number,
	peak: number,
	type: OscillatorType,
	freq: number,
	to: AudioNode,
	slideTo?: number,
	attack?: number
): void {
	const osc = g.ctx.createOscillator();
	osc.type = type;
	osc.frequency.setValueAtTime(freq, at);
	if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, at + length);
	osc.connect(envelope(g, at, length, peak, to, attack));
	osc.start(at);
	osc.stop(at + length + 0.05);
}

/** Filtered noise: steps, scrapes, cracks, wind. */
function hiss(
	g: Graph,
	at: number,
	length: number,
	peak: number,
	filter: BiquadFilterType,
	freq: number,
	to: AudioNode,
	sweepTo?: number,
	attack?: number
): void {
	const source = g.ctx.createBufferSource();
	source.buffer = g.noise;
	const band = g.ctx.createBiquadFilter();
	band.type = filter;
	band.frequency.setValueAtTime(freq, at);
	if (sweepTo) band.frequency.exponentialRampToValueAtTime(sweepTo, at + length);
	band.Q.value = 1.1;
	source.connect(band).connect(envelope(g, at, length, peak, to, attack));
	source.start(at, Math.random());
	source.stop(at + length + 0.05);
}

/** A bell of the family (see bell.ts), struck at `at`; `note` overrides its strike note. */
function bell(g: Graph, size: BellSize, at: number, to: AudioNode, note?: number, scale = 1): void {
	const def = BELLS[size];
	const strike = note ?? def.note;
	for (const p of bellPartials(strike, def.ring)) {
		if (p.freq > 12000) continue;
		const peak = p.gain * def.gain * scale * 0.18;
		tone(g, at, p.length, peak, 'sine', p.freq, to, undefined, 0.004);
		tone(g, at, p.length, peak * 0.35, 'sine', p.freq, g.reverb, undefined, 0.004);
	}
	// The strike itself.
	hiss(g, at, 0.05, 0.25 * def.gain * scale, 'bandpass', Math.min(strike * 6, 9000), to);
}

// ---------------------------------------------------------------------------
// Events

/** Plays what happened at the table (see cues.ts). */
export function play(events: readonly AudioEvent[]): void {
	if (!graph || graph.ctx.state !== 'running') return;
	const g = graph;
	const fx = g.buses.effects;
	const now = g.ctx.currentTime + 0.01;
	// A crowd of steps at once (a patrol, the party travelling) is thinned out.
	let walkers = 0;
	for (const e of events) {
		switch (e.kind) {
			case 'footsteps':
				if (!e.mine && ++walkers > 3) break;
				footsteps(g, now, e.steps, e.ms, e.surface, e.mine ? 1 : 0.45);
				break;
			case 'door':
				if (e.open) {
					tone(g, now, 0.7, 0.12, 'sawtooth', 190, fx, 320);
					hiss(g, now, 0.6, 0.25, 'bandpass', 900, fx, 1500);
					hiss(g, now, 0.04, 0.5, 'highpass', 3000, fx);
				} else {
					tone(g, now, 0.25, 0.6, 'sine', 90, fx, 50);
					hiss(g, now + 0.05, 0.04, 0.5, 'highpass', 3000, fx);
				}
				break;
			case 'bell':
				bell(g, e.size === 'hand' ? 'hand' : e.size, now, fx);
				if (e.size === 'flash') hiss(g, now, 2.5, 0.12, 'highpass', 5000, g.reverb, 9000, 0.8);
				if (e.size === 'great') tone(g, now, 5, 0.25, 'sine', 41, fx, 38, 0.5);
				break;
			case 'dice':
				diceClatter(g, now, e.count);
				break;
			case 'hit':
				hiss(g, now, 0.12, 0.8, 'bandpass', 1300, fx);
				tone(g, now, 0.28, e.heavy ? 0.9 : 0.6, 'sine', e.heavy ? 75 : 110, fx, 45);
				if (e.heavy) hiss(g, now, 0.4, 0.3, 'lowpass', 400, g.reverb);
				break;
			case 'miss':
				hiss(g, now, 0.3, 0.35, 'bandpass', 600, fx, 2400, 0.08);
				break;
			case 'heal':
				[0, 0.09, 0.18].forEach((d, i) =>
					bell(g, 'chime', now + d, fx, 880 * [1, 1.25, 1.5][i], 0.8)
				);
				break;
			case 'guard':
				tone(g, now, 0.3, 0.3, 'square', 240, fx, 200);
				bell(g, 'chime', now, fx, 620, 0.6);
				break;
			case 'burn':
				for (let i = 0; i < 9; i++)
					hiss(g, now + Math.random() * 0.6, 0.03, 0.4, 'highpass', 2500, fx);
				hiss(g, now, 0.7, 0.2, 'lowpass', 700, fx, 300);
				break;
			case 'fall':
				if (e.enemy) {
					tone(g, now, 0.9, 0.5, 'sawtooth', 140, fx, 40);
					hiss(g, now, 0.8, 0.3, 'lowpass', 800, fx, 120);
				} else {
					tone(g, now, 0.5, 0.8, 'sine', 70, fx, 40);
					bell(g, 'motif', now + 0.1, fx, 233, 0.7);
				}
				break;
			case 'check':
				if (e.success) bell(g, 'chime', now + 0.7, fx, 1318);
				else tone(g, now + 0.7, 0.2, 0.2, 'triangle', 220, fx, 180);
				break;
			case 'ui':
				ui(g, now, e.sound);
				break;
		}
	}
}

function footsteps(
	g: Graph,
	at: number,
	steps: number,
	ms: number,
	surface: Surface,
	loud: number
) {
	const fx = g.buses.effects;
	const gap = ms / 1000 / Math.max(steps, 1);
	for (let i = 0; i < steps; i++) {
		const t = at + i * gap + Math.random() * 0.02;
		const v = loud * (0.8 + Math.random() * 0.3);
		if (surface === 'stone') {
			hiss(g, t, 0.05, 0.35 * v, 'bandpass', 1900 + Math.random() * 400, fx);
			tone(g, t, 0.07, 0.25 * v, 'sine', 120, fx, 80);
			hiss(g, t, 0.05, 0.08 * v, 'bandpass', 2000, g.reverb);
		} else if (surface === 'flesh') {
			hiss(g, t, 0.12, 0.35 * v, 'lowpass', 350, fx, 180);
		} else {
			hiss(g, t, 0.08, 0.45 * v, 'lowpass', 700 + Math.random() * 200, fx);
		}
	}
}

function diceClatter(g: Graph, at: number, count: number): void {
	const fx = g.buses.effects;
	const clicks = 5 + count * 3;
	for (let i = 0; i < clicks; i++) {
		// Bounces come quicker and quieter as the dice settle.
		const t = at + 0.9 * (1 - (1 - i / clicks) ** 1.6);
		hiss(g, t, 0.025, 0.55 * (1 - i / clicks) + 0.1, 'bandpass', 2600 + Math.random() * 1800, fx);
	}
}

function ui(g: Graph, at: number, sound: Extract<AudioEvent, { kind: 'ui' }>['sound']): void {
	const fx = g.buses.effects;
	switch (sound) {
		case 'turn':
			bell(g, 'hand', at, fx, 784, 0.8);
			bell(g, 'hand', at + 0.16, fx, 1046, 0.8);
			return;
		case 'clue':
			[1318, 1760, 2093].forEach((f, i) => bell(g, 'chime', at + i * 0.07, fx, f));
			return;
		case 'decision':
			bell(g, 'motif', at, fx, 196, 1.2);
			return;
		case 'chapter':
			// The bell motif: a falling minor third, then the hum below.
			bell(g, 'motif', at, fx, 392);
			bell(g, 'motif', at + 0.45, fx, 330);
			bell(g, 'great', at + 0.9, fx, 131, 0.6);
			return;
		case 'error':
			tone(g, at, 0.14, 0.18, 'triangle', 180, fx, 150);
			return;
		case 'click':
			hiss(g, at, 0.02, 0.12, 'bandpass', 3200, fx);
			return;
	}
}

/** The sound a prop's motion makes (a lever's clank, a chain's rattle, the hand bell). */
export function playMotionSound(sound: Sound): void {
	if (!graph || graph.ctx.state !== 'running') return;
	const g = graph;
	const fx = g.buses.effects;
	const now = g.ctx.currentTime + 0.01;
	switch (sound) {
		case 'clank':
			tone(g, now, 0.35, 0.5, 'square', 190, fx, 120);
			hiss(g, now, 0.08, 0.6, 'highpass', 2500, fx);
			return;
		case 'rattle':
			for (let i = 0; i < 7; i++) hiss(g, now + i * 0.07, 0.06, 0.5, 'bandpass', 2800 + i * 90, fx);
			return;
		case 'grind':
			hiss(g, now, 1.3, 0.7, 'lowpass', 500, fx, 180);
			tone(g, now, 1.3, 0.25, 'sawtooth', 58, fx, 44);
			return;
		case 'chime':
			bell(g, 'hand', now, fx);
			return;
		case 'crack':
			hiss(g, now, 0.18, 0.9, 'bandpass', 1500, fx);
			tone(g, now, 0.12, 0.4, 'triangle', 220, fx, 90);
			return;
		case 'scrape':
			hiss(g, now, 0.55, 0.5, 'bandpass', 900, fx, 600);
			return;
		case 'thud':
			tone(g, now, 0.3, 0.7, 'sine', 95, fx, 48);
			return;
	}
}

// ---------------------------------------------------------------------------
// Ambience: a looping bed per place and hour, crossfaded

interface Bed {
	key: string;
	gain: GainNode;
	stop(): void;
	/** Occasional sounds (a drip, a cricket), called by the conductor. */
	tick(now: number): void;
}

let bed: Bed | null = null;
const FADE = 2.5;

export function setAmbience(next: Ambience | null): void {
	wantedAmbience = next;
	if (!graph) return;
	const key = next ? `${next.place}:${next.time}` : '';
	if (bed?.key === key) return;
	const g = graph;
	const now = g.ctx.currentTime;
	if (bed) {
		const old = bed;
		old.gain.gain.setTargetAtTime(0.0001, now, FADE / 3);
		setTimeout(() => old.stop(), FADE * 1000 + 200);
	}
	bed = next ? makeBed(g, next, key) : null;
	bed?.gain.gain.setTargetAtTime(1, now, FADE / 3);
}

/** Looped noise through a filter, its level wandering slowly (wind, water, breath). */
function loop(
	g: Graph,
	out: AudioNode,
	filter: BiquadFilterType,
	freq: number,
	level: number,
	wander: number
) {
	const source = g.ctx.createBufferSource();
	source.buffer = g.noise;
	source.loop = true;
	const band = g.ctx.createBiquadFilter();
	band.type = filter;
	band.frequency.value = freq;
	const gain = g.ctx.createGain();
	gain.gain.value = level;
	const lfo = g.ctx.createOscillator();
	lfo.frequency.value = wander;
	const depth = g.ctx.createGain();
	depth.gain.value = level * 0.6;
	lfo.connect(depth).connect(gain.gain);
	source.connect(band).connect(gain).connect(out);
	source.start();
	lfo.start();
	return () => {
		source.stop();
		lfo.stop();
	};
}

/** A held low note, two oscillators beating slowly: the Hollow's drone. */
function drone(g: Graph, out: AudioNode, freq: number, level: number) {
	const gain = g.ctx.createGain();
	gain.gain.value = level;
	gain.connect(out);
	const oscs = [freq, freq * 1.012].map((f) => {
		const osc = g.ctx.createOscillator();
		osc.frequency.value = f;
		osc.connect(gain);
		osc.start();
		return osc;
	});
	return () => oscs.forEach((o) => o.stop());
}

function makeBed(g: Graph, amb: Ambience, key: string): Bed {
	const gain = g.ctx.createGain();
	gain.gain.value = 0.0001;
	gain.connect(g.buses.ambience);
	const stops: (() => void)[] = [];
	const night = amb.time !== 'day';
	let next = 0;
	let tick: (now: number) => void = () => {};
	switch (amb.place) {
		case 'village':
		case 'open':
			stops.push(loop(g, gain, 'lowpass', 380, 0.16, 0.07));
			tick = (now) => {
				if (now < next) return;
				next = now + 0.4 + Math.random() * (night ? 1.2 : 3);
				if (night) {
					// Crickets: quick high chirps.
					for (let i = 0; i < 3; i++) tone(g, now + i * 0.06, 0.04, 0.03, 'sine', 4200, gain);
				} else {
					// A bird, now and then.
					tone(g, now, 0.18, 0.03, 'sine', 2600 + Math.random() * 800, gain, 3400);
				}
			};
			break;
		case 'monastery':
			stops.push(loop(g, gain, 'bandpass', 260, 0.14, 0.05));
			stops.push(loop(g, gain, 'bandpass', 1400, 0.02, 0.11));
			tick = (now) => {
				if (now < next) return;
				next = now + 4 + Math.random() * 6;
				// Old timbers settling; far off, a drip.
				tone(g, now, 0.5, 0.04, 'sawtooth', 70 + Math.random() * 40, gain, 55);
			};
			break;
		case 'hollow':
			stops.push(drone(g, gain, 41, 0.09));
			stops.push(loop(g, gain, 'lowpass', 160, 0.1, 0.03));
			tick = (now) => {
				if (now < next) return;
				next = now + 0.8 + Math.random() * 2.5;
				// Water dripping into the black lake.
				const f = 900 + Math.random() * 900;
				tone(g, now, 0.12, 0.05, 'sine', f, gain, f * 0.55);
				tone(g, now, 0.12, 0.02, 'sine', f, g.reverb, f * 0.55);
			};
			break;
		case 'heart':
			stops.push(drone(g, gain, 36, 0.1));
			tick = (now) => {
				if (now < next) return;
				next = now + 1.25;
				// The Heart beating.
				tone(g, now, 0.2, 0.25, 'sine', 55, gain, 38);
				tone(g, now + 0.28, 0.25, 0.18, 'sine', 50, gain, 35);
			};
			break;
	}
	return {
		key,
		gain,
		stop: () => {
			stops.forEach((s) => s());
			gain.disconnect();
		},
		tick
	};
}

// ---------------------------------------------------------------------------
// Music: generative, following the story's mood; transitions crossfade

/** Each mood's scale (Hz, low to high) and the root its pad holds. */
const MOODS: Record<Exclude<MusicState['mood'], 'none'>, { scale: number[]; tempo: number }> = {
	// D minor, open and sad: dusk over the village.
	village: { scale: [146.8, 164.8, 174.6, 196, 220, 233.1, 261.6, 293.7], tempo: 64 },
	// E phrygian: the monastery's cold stone.
	monastery: { scale: [164.8, 174.6, 196, 220, 246.9, 261.6, 293.7, 329.6], tempo: 58 },
	// C locrian-ish, low: the Hollow.
	hollow: { scale: [130.8, 138.6, 155.6, 174.6, 185, 207.7, 233.1, 261.6], tempo: 54 },
	// The Heart: close, dissonant.
	heart: { scale: [110, 116.5, 130.8, 146.8, 155.6, 174.6, 185, 220], tempo: 70 },
	// Resolution: D major, slow.
	ending: { scale: [146.8, 164.8, 185, 196, 220, 246.9, 277.2, 293.7], tempo: 50 },
	// The party fallen: low and still.
	defeat: { scale: [73.4, 77.8, 87.3, 98, 110, 116.5, 130.8, 146.8], tempo: 40 }
};

interface Section {
	state: MusicState;
	gain: GainNode;
	/** When the next bar starts (audio clock). */
	bar: number;
	count: number;
}

let section: Section | null = null;
let conductor: ReturnType<typeof setInterval> | null = null;

export function setMusic(next: MusicState): void {
	wantedMusic = next;
	if (!graph) return;
	const s = section;
	if (
		s &&
		s.state.mood === next.mood &&
		s.state.intensity === next.intensity &&
		s.state.ending === next.ending
	) {
		return;
	}
	const g = graph;
	const now = g.ctx.currentTime;
	// Transition: the old section fades while the new one rises, a bar's worth.
	if (s) {
		s.gain.gain.setTargetAtTime(0.0001, now, 1);
		const old = s.gain;
		setTimeout(() => old.disconnect(), 6000);
	}
	if (next.mood === 'none') {
		section = null;
		return;
	}
	const gain = g.ctx.createGain();
	gain.gain.value = 0.0001;
	gain.gain.setTargetAtTime(1, now, 1.2);
	gain.connect(g.buses.music);
	section = { state: next, gain, bar: now + 0.1, count: 0 };
	// A change of mood is marked by the bell: the motif, or the ending's cadence.
	if (s && (s.state.mood !== next.mood || next.intensity > s.state.intensity)) {
		const m = MOODS[next.mood];
		bell(g, 'motif', now + 0.05, gain, m.scale[4], 0.8);
		bell(g, 'motif', now + 0.6, gain, m.scale[2], 0.8);
	}
}

function startConductor(): void {
	if (conductor) return;
	conductor = setInterval(() => {
		const g = graph;
		if (!g || g.ctx.state !== 'running') return;
		const now = g.ctx.currentTime;
		bed?.tick(now);
		if (!section) {
			if (wantedMusic.mood !== 'none') setMusic(wantedMusic);
			return;
		}
		// Schedule bars a little ahead of the clock.
		while (section.bar < now + 0.6) {
			scheduleBar(g, section, section.bar);
			section.bar += barLength(section.state);
			section.count++;
		}
	}, 150);
}

function barLength(state: MusicState): number {
	const tempo = state.mood === 'none' ? 60 : MOODS[state.mood].tempo;
	const speed = [1, 1.1, 1.6, 1.9][state.intensity];
	return (4 * 60) / (tempo * speed);
}

/** One bar: the pad's chord, the bell motif now and then, and a pulse in a fight. */
function scheduleBar(g: Graph, s: Section, at: number): void {
	if (s.state.mood === 'none') return;
	const { scale } = MOODS[s.state.mood];
	const length = barLength(s.state);
	const out = s.gain;
	const intensity = s.state.intensity;
	// Pad: root and fifth-ish, slow swell, moving between two chords every other bar.
	const shift = s.count % 4 >= 2 ? 1 : 0;
	const chord = [scale[0 + shift] / 2, scale[2 + shift], scale[4 + shift]];
	for (const f of chord) pad(g, at, length * 1.05, f, out, intensity >= 2 ? 0.07 : 0.06);
	// The bell motif, every few bars in calm, more often in tension.
	const every = [4, 3, 2, 2][intensity];
	if (s.count % every === 0) {
		const notes = s.count % (every * 2) === 0 ? [7, 5, 4] : [6, 4, 2];
		notes.forEach((n, i) =>
			bell(g, 'motif', at + i * (length / 4), out, scale[n] ?? scale[0], 0.6)
		);
	}
	// A fight: a low pulse on every beat, and an ostinato on the off-beats.
	if (intensity >= 2) {
		for (let beat = 0; beat < 4; beat++) {
			const t = at + (beat * length) / 4;
			tone(g, t, 0.25, 0.35, 'sine', 60, out, 38);
			const note = scale[[0, 1, 0, 3][beat]] / 2;
			tone(g, t + length / 8, 0.18, 0.08, 'triangle', note, out);
		}
	}
	// The finale: the great bell's hum under everything.
	if (intensity === 3) tone(g, at, length, 0.08, 'sine', scale[0] / 4, out, undefined, 0.5);
}

/** A soft sustained note: two detuned saws, filtered dark, swelling in and out. */
function pad(g: Graph, at: number, length: number, freq: number, out: AudioNode, level: number) {
	const filter = g.ctx.createBiquadFilter();
	filter.type = 'lowpass';
	filter.frequency.value = 900;
	const gain = g.ctx.createGain();
	gain.gain.setValueAtTime(0.0001, at);
	gain.gain.linearRampToValueAtTime(level, at + length * 0.4);
	gain.gain.linearRampToValueAtTime(0.0001, at + length);
	filter.connect(gain).connect(out);
	for (const detune of [-6, 6]) {
		const osc = g.ctx.createOscillator();
		osc.type = 'sawtooth';
		osc.frequency.value = freq;
		osc.detune.value = detune;
		osc.connect(filter);
		osc.start(at);
		osc.stop(at + length + 0.05);
	}
}
