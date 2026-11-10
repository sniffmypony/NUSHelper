import {
  pgTable,
  serial,
  text,
  date,
  boolean,
  timestamp,
  integer,
  uniqueIndex,
  bigint,
  index,
} from "drizzle-orm/pg-core";

export const tasks = pgTable("tasks", {
  id: serial("id").primaryKey(),
  description: text("description").notNull(),
  module: text("module"), // e.g. "CS2102", nullable
  dueDate: date("due_date"), // nullable, format YYYY-MM-DD
  done: boolean("done").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Ephemeral daily list — wiped every night by the checkin-and-clear cron job.
export const todos = pgTable("todos", {
  id: serial("id").primaryKey(),
  description: text("description").notNull(),
  // Set only for items automatically rolled over from a dated task.
  // Unique keeps a retried daily cron from adding the same task twice.
  taskId: integer("task_id")
    .references(() => tasks.id, { onDelete: "cascade" })
    .unique(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const calendarEventMappings = pgTable(
  "calendar_event_mappings",
  {
    id: serial("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    chatId: text("chat_id").notNull(),
    messageId: integer("message_id").notNull(),
    sourceLine: integer("source_line").notNull().default(0),
    calendarId: text("calendar_id").notNull(),
    googleEventId: text("google_event_id").notNull(),
    googleHtmlLink: text("google_html_link"),
    actionToken: text("action_token").notNull().unique(),
    title: text("title").notNull(),
    startDateTime: text("start_datetime").notNull(),
    endDateTime: text("end_datetime").notNull(),
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    sourceMessageUnique: uniqueIndex("calendar_mapping_source_unique").on(
      table.ownerId,
      table.chatId,
      table.messageId,
      table.sourceLine,
    ),
    googleEventUnique: uniqueIndex("calendar_mapping_google_event_unique").on(
      table.calendarId,
      table.googleEventId,
    ),
  }),
);

export const calendarPendingEvents = pgTable("calendar_pending_events", {
  operationId: text("operation_id").primaryKey(),
  kind: text("kind").notNull(),
  ownerId: text("owner_id").notNull(),
  chatId: text("chat_id").notNull(),
  messageId: integer("message_id").notNull(),
  sourceLine: integer("source_line").notNull().default(0),
  title: text("title"),
  startDateTime: text("start_datetime"),
  endDateTime: text("end_datetime"),
  googleEventId: text("google_event_id"),
  targetMappingId: integer("target_mapping_id").references(
    () => calendarEventMappings.id,
    { onDelete: "cascade" },
  ),
  status: text("status").notNull().default("pending"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const reminders = pgTable(
  "reminders",
  {
    id: serial("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    chatId: text("chat_id").notNull(),
    sourceMessageId: integer("source_message_id").notNull(),
    sourceLine: integer("source_line").notNull().default(0),
    description: text("description").notNull(),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    sourceUnique: uniqueIndex("reminders_source_unique").on(
      table.ownerId,
      table.chatId,
      table.sourceMessageId,
      table.sourceLine,
    ),
  }),
);

export const morningAcknowledgements = pgTable(
  "morning_acknowledgements",
  {
    id: serial("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    acknowledgementDate: date("acknowledgement_date").notNull(),
    messageId: integer("message_id"),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    ownerDateUnique: uniqueIndex("morning_ack_owner_date_unique").on(
      table.ownerId,
      table.acknowledgementDate,
    ),
  }),
);

export const expenditureDays = pgTable("expenditure_days", {
  spendDate: date("spend_date").primaryKey(),
  totalCents: integer("total_cents").notNull().default(0),
  status: text("status").notNull().default("pending"),
  promptSentAt: timestamp("prompt_sent_at", { withTimezone: true }),
  reminderSentAt: timestamp("reminder_sent_at", { withTimezone: true }),
  loggedAt: timestamp("logged_at", { withTimezone: true }),
  autoZeroedAt: timestamp("auto_zeroed_at", { withTimezone: true }),
  missingNoticeSentAt: timestamp("missing_notice_sent_at", {
    withTimezone: true,
  }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const expenditureAdjustments = pgTable(
  "expenditure_adjustments",
  {
    id: serial("id").primaryKey(),
    spendDate: date("spend_date")
      .notNull()
      .references(() => expenditureDays.spendDate, { onDelete: "cascade" }),
    ownerId: text("owner_id").notNull(),
    chatId: text("chat_id").notNull(),
    sourceMessageId: integer("source_message_id").notNull(),
    kind: text("kind").notNull(),
    amountCents: integer("amount_cents").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    sourceUnique: uniqueIndex("expenditure_adjustment_source_unique").on(
      table.ownerId,
      table.chatId,
      table.sourceMessageId,
    ),
  }),
);

export const expenditureInputSessions = pgTable("expenditure_input_sessions", {
  ownerId: text("owner_id").primaryKey(),
  chatId: text("chat_id").notNull(),
  spendDate: date("spend_date")
    .notNull()
    .references(() => expenditureDays.spendDate, { onDelete: "cascade" }),
  mode: text("mode").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const expenditureReports = pgTable(
  "expenditure_reports",
  {
    id: serial("id").primaryKey(),
    reportType: text("report_type").notNull(),
    periodStart: date("period_start").notNull(),
    periodEnd: date("period_end").notNull(),
    revision: integer("revision").notNull().default(1),
    sentRevision: integer("sent_revision").notNull().default(0),
    claimedRevision: integer("claimed_revision"),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    lastSentAt: timestamp("last_sent_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    periodUnique: uniqueIndex("expenditure_report_period_unique").on(
      table.reportType,
      table.periodStart,
      table.periodEnd,
    ),
  }),
);

// One row per Telegram update the Canvas assistant has started, so webhook
// retries never produce a second reply.
export const assistantUpdateClaims = pgTable("assistant_update_claims", {
  updateId: bigint("update_id", { mode: "number" }).primaryKey(),
  claimedAt: timestamp("claimed_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// Recent assistant conversation per chat, used for follow-up questions.
export const assistantMessages = pgTable(
  "assistant_messages",
  {
    id: serial("id").primaryKey(),
    chatId: text("chat_id").notNull(),
    role: text("role").notNull(),
    content: text("content").notNull(),
    toolContext: text("tool_context"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    chatCreatedIdx: index("assistant_messages_chat_created_idx").on(
      table.chatId,
      table.createdAt,
    ),
  }),
);

// Telegram's id for a Canvas file the bot has already uploaded. Re-sending by
// this id skips the Canvas download and the upload. A changed Canvas file has
// a new updated_at, which misses the cache.
export const telegramFileCache = pgTable("telegram_file_cache", {
  canvasFileId: bigint("canvas_file_id", { mode: "number" }).primaryKey(),
  canvasUpdatedAt: text("canvas_updated_at").notNull(),
  telegramFileId: text("telegram_file_id").notNull(),
  cachedAt: timestamp("cached_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
