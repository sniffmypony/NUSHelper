import { telegramBotToken, telegramOwnerId } from "./env.js";

interface TelegramApiResponse {
  ok?: boolean;
  description?: string;
}

export class TelegramDeliveryError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "TelegramDeliveryError";
  }
}

export type TelegramInlineKeyboard = {
  inline_keyboard: Array<Array<{ text: string; callback_data: string }>>;
};

export type SendTelegramMessageOptions = {
  chatId?: string | number;
  silent?: boolean;
  replyMarkup?: TelegramInlineKeyboard;
};

export async function sendTelegramMessage(
  text: string,
  options: SendTelegramMessageOptions = {},
): Promise<void> {
  const botToken = telegramBotToken();
  const ownerId = telegramOwnerId();
  const numericOwnerId = Number(ownerId);
  if (
    !/^\d+$/.test(ownerId) ||
    !Number.isSafeInteger(numericOwnerId) ||
    numericOwnerId <= 0
  ) {
    throw new Error(
      "TELEGRAM_OWNER_ID must be a positive numeric Telegram user ID",
    );
  }

  const response = await fetch(
    `https://api.telegram.org/bot${botToken}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: options.chatId ?? ownerId,
        text,
        ...(options.silent ? { disable_notification: true } : {}),
        ...(options.replyMarkup ? { reply_markup: options.replyMarkup } : {}),
      }),
    },
  );

  const rawBody = await response.text();
  let payload: TelegramApiResponse | undefined;
  try {
    payload = JSON.parse(rawBody) as TelegramApiResponse;
  } catch {
    // The status code and generic message below still make a non-JSON response actionable.
  }

  if (!response.ok || payload?.ok !== true) {
    const reason = payload?.description ?? `HTTP ${response.status}`;
    throw new TelegramDeliveryError(
      `Telegram sendMessage failed: ${reason}`,
      response.status,
    );
  }
}
