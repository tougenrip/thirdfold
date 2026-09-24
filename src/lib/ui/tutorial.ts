// A new player's first session: join, name, character, welcome, onboarding,
// start. Onboarding teaches by doing: each step is done when the player does
// that thing at the table (walks, looks around, walks up to the glow nearby,
// inspects it, talks to someone, opens their sheet, chats or rolls), in any
// order. Local UI state
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

export type TutorialStepId =
	'move' | 'look' | 'approach' | 'inspect' | 'discovered' | 'talk' | 'sheet' | 'chat';

export interface TutorialStep {
	id: TutorialStepId;
	title: string;
	text: string;
	/** Only where the story has a first find for newcomers (see `AdventureView.firstFind`). */
	needsFind?: true;
	/** Done by pressing the coach's button rather than by doing something at the table. */
	button?: string;
}

/**
 * Onboarding: the core of how thirdfold plays, learned by doing it. Walk,
 * look around, notice the glow nearby, walk up, inspect it, and see what you
 * found; then the rest of the table (people, your sheet, the chat).
 */
export const TUTORIAL: readonly TutorialStep[] = [
	{
		id: 'move',
		title: 'Move your miniature',
		text: 'Click a cell near your character to walk there. Outside a fight you can walk as far as you like.'
	},
	{
		id: 'look',
		title: 'Look around',
		text: 'Press Observe in the bar at the bottom to look around where you stand. Listen works the same way, with your ears.'
	},
	{
		id: 'approach',
		title: 'Something is glowing nearby',
		text: 'A faint light is glowing close by; it is marked on the table. Walk up and stand beside it.',
		needsFind: true
	},
	{
		id: 'inspect',
		title: 'Inspect it',
		text: 'It is right beside you. Click it on the table, or press its button in the bar, to look closer.',
		needsFind: true
	},
	{
		id: 'discovered',
		title: 'You’ve discovered something',
		text: 'What your character finds is theirs alone until you share it. You will find it under Evidence in the story panel, with a Share button.',
		needsFind: true,
		button: 'Got it'
	},
	{
		id: 'talk',
		title: 'Talk to someone',
		text: 'Walk up to one of the villagers and click them. People tell you things, and remember what you ask.'
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

/**
 * The step an action sent to the server counts toward, if any. `kindOf` tells
 * what kind of thing an interaction was aimed at (talking needs a person).
 * Walking, coming close, inspecting and discovering are seen on the table.
 */
export function signalOf(
	action: { type: string; targetId?: string | null },
	kindOf: (id: string) => string | undefined = () => undefined
): Signal | null {
	switch (action.type) {
		case 'adventure_interact':
			return action.targetId && kindOf(action.targetId) === 'npc' ? 'talk' : null;
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

/**
 * The step to show: the first not yet done, skipping the first find's steps
 * where there is none to find (`hasFind`); null when all are done (time to start).
 */
export function currentStep(progress: TutorialProgress, hasFind = true): TutorialStep | null {
	return TUTORIAL.find((s) => !progress.done.includes(s.id) && (hasFind || !s.needsFind)) ?? null;
}

/** Where the player is in the first session, for the step indicator. */
export function sessionStep(progress: TutorialProgress, hasFind = true): FirstSessionStep {
	if (progress.stage === 'welcome') return 3;
	if (progress.stage === 'tutorial') return currentStep(progress, hasFind) ? 4 : 5;
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
