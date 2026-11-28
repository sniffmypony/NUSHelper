// Replies to something the owner just did (pressed a button, sent an
// amount, asked for a file) arrive without a notification: they're looking
// at the chat already. Messages the bot starts itself (reminders, questions,
// check-ins) still notify.
export const QUIET = { disable_notification: true } as const;
