import type { DeletableKind } from "../assistant/bot-tools.js";

// The website's version of the bot's Telegram buttons. When the assistant
// wants to delete something or add a Google Calendar event, it only adds a
// card to its reply; nothing happens until the user presses Confirm. Things
// it added get an Undo card. Cards are stored with the message, so what a
// press does always comes from the server, never from the browser.

export type CardState = "pending" | "done" | "cancelled" | "failed";

type Base = { label: string; state: CardState; result?: string };

export type ChatCard =
  | (Base & { type: "delete"; kind: DeletableKind; id: number })
  | (Base & { type: "undo"; kind: DeletableKind; id: number })
  | (Base & { type: "calendar-create"; line: string })
  | (Base & { type: "calendar-delete"; eventId: string });

export interface CardExecutors {
  performDelete(kind: DeletableKind, id: number): Promise<string>;
  addCalendarEvent(line: string): Promise<{ ok: boolean; message: string }>;
  deleteCalendarEvent(
    eventId: string,
  ): Promise<{ ok: boolean; message: string }>;
}

export class CardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CardError";
  }
}

const KINDS = new Set(["todo", "task", "rem", "rep"]);
const STATES = new Set(["pending", "done", "cancelled", "failed"]);

// Cards read back from the database; anything malformed is dropped.
export function parseCards(value: unknown): ChatCard[] {
  if (!Array.isArray(value)) return [];
  return value.filter((card): card is ChatCard => {
    if (!card || typeof card !== "object") return false;
    const c = card as Record<string, unknown>;
    if (typeof c.label !== "string" || !STATES.has(c.state as string)) {
      return false;
    }
    switch (c.type) {
      case "delete":
      case "undo":
        return KINDS.has(c.kind as string) && Number.isSafeInteger(c.id);
      case "calendar-create":
        return typeof c.line === "string";
      case "calendar-delete":
        return typeof c.eventId === "string";
      default:
        return false;
    }
  });
}

// Confirm (or Undo) runs the card's action; Cancel only marks it. A card is
// done once it worked or was cancelled; one that failed can be tried again.
export async function applyCard(
  card: ChatCard,
  action: "confirm" | "cancel",
  run: CardExecutors,
): Promise<ChatCard> {
  if (card.state === "done" || card.state === "cancelled") {
    throw new CardError("That was already done.");
  }
  if (action === "cancel") {
    if (card.type === "undo") throw new CardError("Undo can't be cancelled.");
    return { ...card, state: "cancelled", result: "Kept." };
  }
  try {
    switch (card.type) {
      case "delete":
        return {
          ...card,
          state: "done",
          result: await run.performDelete(card.kind, card.id),
        };
      case "undo":
        return {
          ...card,
          state: "done",
          result: `Undone. ${await run.performDelete(card.kind, card.id)}`,
        };
      case "calendar-create": {
        const outcome = await run.addCalendarEvent(card.line);
        return {
          ...card,
          state: outcome.ok ? "done" : "failed",
          result: outcome.message,
        };
      }
      case "calendar-delete": {
        const outcome = await run.deleteCalendarEvent(card.eventId);
        return {
          ...card,
          state: outcome.ok ? "done" : "failed",
          result: outcome.message,
        };
      }
    }
  } catch (error) {
    const type = error instanceof Error ? error.name : typeof error;
    console.error(`Chat card failed (${type})`);
    return { ...card, state: "failed", result: "That didn't work. Try again." };
  }
}
