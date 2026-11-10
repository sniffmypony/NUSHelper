import type { DeletableKind, UndoRef } from "./bot-tools.js";

export type InlineKeyboard = {
  inline_keyboard: Array<Array<{ text: string; callback_data: string }>>;
};

export function confirmDeleteKeyboard(
  kind: DeletableKind,
  id: number,
): InlineKeyboard {
  return {
    inline_keyboard: [
      [
        { text: "Delete", callback_data: `ai:del:${kind}:${id}` },
        { text: "Keep", callback_data: "ai:keep" },
      ],
    ],
  };
}

// Adds a "Think harder" button that re-runs a saved question at high effort.
export function withThinkHarder(
  keyboard: InlineKeyboard | undefined,
  requestId: number | undefined,
): InlineKeyboard | undefined {
  if (requestId === undefined) return keyboard;
  return {
    inline_keyboard: [
      ...(keyboard?.inline_keyboard ?? []),
      [{ text: "Think harder", callback_data: `ai:think:${requestId}` }],
    ],
  };
}

export function undoKeyboard(refs: UndoRef[]): InlineKeyboard | undefined {
  if (refs.length === 0) return undefined;
  return {
    inline_keyboard: refs.map((ref) => {
      const label = `Undo: ${ref.label}`;
      return [
        {
          text: label.length > 48 ? `${label.slice(0, 47)}…` : label,
          callback_data: `ai:undo:${ref.kind}:${ref.id}`,
        },
      ];
    }),
  };
}
