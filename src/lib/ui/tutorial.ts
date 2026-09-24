// A new player's first session: join, name, character, welcome, the
// interactive tutorial, start. The tutorial teaches by doing: each step is
// done when the player does that thing at the table (walks, talks, looks
// around, opens their sheet, chats or rolls), in any order. Local UI state
// only; the server knows nothing of it. Kept free of story text, which only
// ever comes from the server.

/** The first session, in order; `FirstSessionStep` indexes it. */
export const FIRST_SESSION = [
	'Join',
	'Your name',
	'Character',
	'Welcome',
	'Learn to play',
	'Start'
] as const;

export type FirstSessionStep = number;

export type TutorialStepId = 'move' | 'interact' | 'look' | 'sheet' | 'chat';

export interface TutorialStep {
	id: TutorialStepId;
	title: string;
	text: string;
}

export const TUTORIAL: readonly TutorialStep[] = [
	{
		id: 'move',
		title: 'Walk',
		text: 'Click a cell near your character to walk there. Outside a fight you can walk as far as you like.'
	},
	{
		id: 'interact',
		title: 'Talk and touch',
		text: 'Walk up to a person or a thing and click it, or use the buttons that appear in the bar at the bottom. People talk, doors open, and things can be examined.'
	},
	{
		id: 'look',
		title: 'Look and listen',
		text: 'Press Observe or Listen in the bar to search where you stand. Some things only turn up this way.'
	},
	{
		id: 'sheet',
		title: 'Your character',
		text: 'Click your character’s name in the bar to see who they are and what they can do.'
	},
	{
		id: 'chat',
		title: 'Talk to the table',
		text: 'Say something in the chat, or click a die under it to roll. Everyone at the table sees it.'
	}
];

/**
 * Where a player is: the welcome card, learning to play, or done (they
 * pressed Start, or skipped). `done` is the steps they have already done.
 */
export interface TutorialProgress {
	stage: 'welcome' | 'tutorial' | 'done';
	done: TutorialStepId[];
}

export const NEW_PLAYER: TutorialProgress = { stage: 'welcome', done: [] };

/** What a player did that the tutorial watches for. */
export type Signal = TutorialStepId;

/** The step an action sent to the server counts toward, if any (walking is watched on the table). */
export function signalOf(action: { type: string }): Signal | null {
	switch (action.type) {
		case 'adventure_interact':
			return 'interact';
		case 'adventure_sense':
			return 'look';
		case 'chat_send':
		case 'dice_roll':
			return 'chat';
		default:
			return null;
	}
}

/** Marks a step done (once); nothing changes once the tutorial is over. */
export function record(progress: TutorialProgress, step: Signal): TutorialProgress {
	if (progress.stage === 'done' || progress.done.includes(step)) return progress;
	return { ...progress, done: [...progress.done, step] };
}

/** The step to show: the first not yet done, or null when all are (time to start). */
export function currentStep(progress: TutorialProgress): TutorialStep | null {
	return TUTORIAL.find((s) => !progress.done.includes(s.id)) ?? null;
}

/** Where the player is in the first session, for the step indicator. */
export function sessionStep(progress: TutorialProgress): FirstSessionStep {
	if (progress.stage === 'welcome') return 3;
	if (progress.stage === 'tutorial') return currentStep(progress) ? 4 : 5;
	return 5;
}

const KEY = (roomId: string) => `thirdfold:tutorial:${roomId}`;

/** A player's progress at this table, from `storage` (a new player's if there is none, or it is unreadable). */
export function loadProgress(storage: Pick<Storage, 'getItem'>, roomId: string): TutorialProgress {
	try {
		const raw = JSON.parse(storage.getItem(KEY(roomId)) ?? 'null') as unknown;
		if (typeof raw !== 'object' || raw === null) return NEW_PLAYER;
		const { stage, done } = raw as Record<string, unknown>;
		if (stage !== 'welcome' && stage !== 'tutorial' && stage !== 'done') return NEW_PLAYER;
		const ids = TUTORIAL.map((s) => s.id);
		const steps = Array.isArray(done)
			? ids.filter((id) => done.includes(id))
			: ([] as TutorialStepId[]);
		return { stage, done: steps };
	} catch {
		return NEW_PLAYER;
	}
}

export function saveProgress(
	storage: Pick<Storage, 'setItem'>,
	roomId: string,
	progress: TutorialProgress
): void {
	try {
		storage.setItem(KEY(roomId), JSON.stringify(progress));
	} catch {
		// Private windows and full storage: the tutorial just starts over next time.
	}
}
