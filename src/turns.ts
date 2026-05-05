// group meta events into turns. boundary = stop event, or new
// user_message arriving while a turn is still open.

import type { MetaEvent } from "./jsonl";

export type Turn = {
  id: string;                 // first event uuid (the user_message that opened it)
  startTs: number;
  endTs: number;
  events: MetaEvent[];
  userPromptText?: string;    // first user_message text — quick hint
  outputTokens: number;       // sum of assistant_text.tokens (when present)
  outputChars: number;        // sum of assistant_text.text.length (fallback)
  toolUseCount: number;
  linesAdded: number;
  linesRemoved: number;
  closed: boolean;
};

export type TurnsState = {
  turns: Turn[];
  current: Turn | null;
};

export function createTurnsState(): TurnsState {
  return { turns: [], current: null };
}

export type IngestResult = { closed?: Turn; opened?: Turn };

export function ingestEvent(state: TurnsState, ev: MetaEvent): IngestResult {
  if (ev.kind === "user_message") {
    const closed = state.current && !state.current.closed ? closeTurn(state.current) : undefined;
    const opened = newTurn(ev);
    state.current = opened;
    state.turns.push(opened);
    tally(opened, ev);
    return closed ? { closed, opened } : { opened };
  }

  if (!state.current || state.current.closed) {
    // event before any user_message — drop for v1
    return {};
  }

  tally(state.current, ev);

  if (ev.kind === "stop") {
    return { closed: closeTurn(state.current) };
  }
  return {};
}

function newTurn(ev: MetaEvent): Turn {
  const turn: Turn = {
    id: ev.uuid,
    startTs: ev.ts,
    endTs: ev.ts,
    events: [],
    outputTokens: 0,
    outputChars: 0,
    toolUseCount: 0,
    linesAdded: 0,
    linesRemoved: 0,
    closed: false,
  };
  if (ev.kind === "user_message") turn.userPromptText = ev.text;
  return turn;
}

function tally(turn: Turn, ev: MetaEvent): void {
  turn.events.push(ev);
  turn.endTs = ev.ts;
  if (ev.kind === "assistant_text") {
    if (typeof ev.tokens === "number") turn.outputTokens += ev.tokens;
    turn.outputChars += ev.text.length;
  } else if (ev.kind === "tool_use") {
    turn.toolUseCount += 1;
    if (typeof ev.linesAdded === "number") turn.linesAdded += ev.linesAdded;
    if (typeof ev.linesRemoved === "number") turn.linesRemoved += ev.linesRemoved;
  }
}

function closeTurn(turn: Turn): Turn {
  turn.closed = true;
  return turn;
}
