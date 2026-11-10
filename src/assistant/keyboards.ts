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
