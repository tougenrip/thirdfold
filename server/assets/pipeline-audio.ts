// Sounds for the asset pipeline (pipeline.ts): assets/audio, a bell rendered
// from a recipe, or a WAV or Ogg file checked by its header.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { AUDIO_LIMITS, type AudioEntry } from '../../src/lib/assets/manifest';
import { BELLS, type BellSize } from '../../src/lib/audio/bell';
import { audioInfo, encodeWav, renderBell } from './audio';
import { creditOf, provenanceFor } from './licence';
import { AssetError, checkMeta, idOf, isRecord, list, readJson, type Emit } from './pipeline-files';

export function buildAudio(dir: string, emit: Emit): Record<string, AudioEntry> {
	const audio: Record<string, AudioEntry> = {};
	const audioDir = path.join(dir, 'audio');
	for (const name of list(audioDir)) {
		const source = path.join(audioDir, name);
		const { id, ext } = idOf(name, audioDir);
		if (ext === 'meta.json') {
			checkMeta(audioDir, id, 'wav', 'ogg');
			continue;
		}
		if (Object.hasOwn(audio, id))
			throw new AssetError(source, 'a sound with this id already exists');
		let data: Buffer;
		if (ext === 'json') {
			const raw = readJson(source);
			const bell = isRecord(raw)
				? (Object.keys(BELLS) as BellSize[]).find((b) => b === raw.bell)
				: undefined;
			const rate = isRecord(raw) ? raw.rate : undefined;
			if (!bell || typeof rate !== 'number' || rate < 8000 || rate > 48000) {
				throw new AssetError(source, 'a sound recipe is { "bell": <size>, "rate": 8000..48000 }');
			}
			data = encodeWav(renderBell(bell, rate), rate);
		} else if (ext === 'wav' || ext === 'ogg') data = readFileSync(source);
		else throw new AssetError(source, 'sounds are .json recipes, .wav or .ogg');
		const info = audioInfo(data);
		if (!info || info.format !== (ext === 'json' ? 'wav' : ext))
			throw new AssetError(source, 'not a WAV or Ogg file');
		if (info.duration > AUDIO_LIMITS.seconds) throw new AssetError(source, 'too long');
		if (data.length > AUDIO_LIMITS.bytes) throw new AssetError(source, 'file too large');
		audio[id] = {
			...emit('audio', id, info.format, data),
			bytes: data.length,
			format: info.format,
			duration: Math.round(info.duration * 1000) / 1000,
			credit: creditOf(provenanceFor(audioDir, id, ext))
		};
	}
	return audio;
}
