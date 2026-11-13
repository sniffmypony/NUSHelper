import { asc, eq, sql } from "drizzle-orm";
import type { Telegraf } from "telegraf";
import {
  confirmDeleteKeyboard,
  type InlineKeyboard,
} from "./assistant/keyboards.js";
import { db } from "./db/client.js";
import { recurringItems, todos } from "./db/schema.js";
import {
  RECURRING_USAGE,
  decodeRule,
  describeRule,
  encodeRule,
  isDueOn,
  parseRecurringCommand,
  type RecurrenceRule,
} from "./recurrence.js";

// Repeating items (/every): each one adds itself to the to-do list on the
// mornings it is due. /repeats lists them; deleting asks Delete/Keep first.

export type RecurringResult = { message: string; id?: number; label?: string };

function ruleText(rule: string): string {
  const decoded = decodeRule(rule);
  return decoded ? describeRule(decoded) : rule;
}

export async function addRecurring(
  rule: RecurrenceRule,
  description: string,
): Promise<RecurringResult> {
  const [row] = await db
    .insert(recurringItems)
    .values({ description, rule: encodeRule(rule) })
    .returning({ id: recurringItems.id });
  return {
    id: row.id,
    label: description,
    message: `Repeating ${describeRule(rule)}: ${description}\nIt joins your to-do list at 8am on those days.`,
  };
}

export async function allRecurring(): Promise<
  Array<{ id: number; description: string; rule: string }>
> {
  return db
    .select({
      id: recurringItems.id,
      description: recurringItems.description,
      rule: recurringItems.rule,
    })
    .from(recurringItems)
    .orderBy(asc(recurringItems.id));
}

// withId is for the assistant, which needs ids for its tools.
export async function listRecurring(withId = false): Promise<string> {
  const items = await allRecurring();
  if (items.length === 0) return "Nothing is set to repeat.";
  return items
    .map(
      (item) =>
        `• ${item.description} — ${ruleText(item.rule)}${withId ? ` (repeating_id ${item.id})` : ""}`,
    )
    .join("\n");
}

export async function findRecurring(
  id: number,
): Promise<{ id: number; description: string; when: string } | null> {
  const [row] = await db
    .select()
    .from(recurringItems)
    .where(eq(recurringItems.id, id))
    .limit(1);
  return row
    ? { id: row.id, description: row.description, when: ruleText(row.rule) }
    : null;
}

export async function deleteRecurring(id: number): Promise<string> {
  const deleted = await db
    .delete(recurringItems)
    .where(eq(recurringItems.id, id))
    .returning({ description: recurringItems.description });
  if (deleted.length === 0) {
    return "That repeating item wasn't found. It may already be deleted.";
  }
  return `Stopped repeating: ${deleted[0].description}`;
}

// Called by the morning job. Each due item is added once per day, even if
// the job runs twice. Returns how many were added.
export async function addDueRecurringTodos(today: string): Promise<number> {
  const items = await db.select().from(recurringItems);
  let added = 0;
  for (const item of items) {
    const rule = decodeRule(item.rule);
    if (!rule || !isDueOn(rule, today)) continue;
    const claimed = await db
      .update(recurringItems)
      .set({ lastAddedOn: today })
      .where(
        sql`${recurringItems.id} = ${item.id} and ${recurringItems.lastAddedOn} is distinct from ${today}::date`,
      )
      .returning({ id: recurringItems.id });
    if (claimed.length === 0) continue;
    await db.insert(todos).values({ description: item.description });
    added += 1;
  }
  return added;
}

const BUTTON_TEXT_LIMIT = 48;

export function recurringKeyboard(
  items: Array<{ id: number; description: string }>,
): InlineKeyboard {
  return {
    inline_keyboard: items.slice(0, 30).map((item) => {
      const text = `Stop: ${item.description}`;
      return [
        {
          text:
            text.length > BUTTON_TEXT_LIMIT
              ? `${text.slice(0, BUTTON_TEXT_LIMIT - 1)}…`
              : text,
          callback_data: `rep:ask:${item.id}`,
        },
      ];
    }),
  };
}

export function registerRecurringCommands(bot: Telegraf): void {
  bot.command("every", async (ctx) => {
    const parsed = parseRecurringCommand(ctx.message.text);
    if (!parsed) return ctx.reply(RECURRING_USAGE);
    return ctx.reply(
      (await addRecurring(parsed.rule, parsed.description)).message,
    );
  });

  bot.command("repeats", async (ctx) => {
    const items = await allRecurring();
    if (items.length === 0) {
      return ctx.reply(
        "Nothing is set to repeat. Add one with /every, e.g. /every mon tutorial prep",
      );
    }
    return ctx.reply(
      `${await listRecurring()}\n\nTap one below to stop it repeating.`,
      { reply_markup: recurringKeyboard(items) },
    );
  });

  bot.action(/^rep:ask:(\d{1,10})$/, async (ctx) => {
    try {
      await ctx.answerCbQuery();
    } catch {
      // Telegram may retry an old callback after its acknowledgement window.
    }
    const id = Number(ctx.match[1]);
    if (!Number.isSafeInteger(id) || id <= 0 || id > 2_147_483_647) return;
    const item = await findRecurring(id);
    if (!item) {
      await ctx.reply(
        "That repeating item wasn't found. It may already be deleted.",
      );
      return;
    }
    await ctx.reply(`Stop repeating ${item.when}: ${item.description}?`, {
      reply_markup: confirmDeleteKeyboard("rep", id),
    });
  });
}
