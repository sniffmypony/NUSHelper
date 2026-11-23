import { desc, eq, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { botSecrets, botSettings, settingsAudit } from "../db/schema.js";

export interface StoredValue {
  value: string;
  updatedAt: Date;
}

export interface StoredSecret {
  ciphertext: string;
  lastFour: string;
  updatedAt: Date;
}

export interface AuditEntry {
  key: string;
  action: string;
  createdAt: Date;
}

export interface SettingsStore {
  values(): Promise<Map<string, StoredValue>>;
  secrets(): Promise<Map<string, StoredSecret>>;
  setValue(key: string, value: string): Promise<void>;
  clearValue(key: string): Promise<void>;
  setSecret(key: string, ciphertext: string, lastFour: string): Promise<void>;
  clearSecret(key: string): Promise<void>;
  addAudit(key: string, action: string): Promise<void>;
  audit(limit: number): Promise<AuditEntry[]>;
}

export const settingsStore: SettingsStore = {
  async values() {
    const rows = await db.select().from(botSettings);
    return new Map(
      rows.map((row) => [
        row.key,
        { value: row.value, updatedAt: row.updatedAt },
      ]),
    );
  },

  async secrets() {
    const rows = await db.select().from(botSecrets);
    return new Map(
      rows.map((row) => [
        row.key,
        {
          ciphertext: row.ciphertext,
          lastFour: row.lastFour,
          updatedAt: row.updatedAt,
        },
      ]),
    );
  },

  async setValue(key, value) {
    await db
      .insert(botSettings)
      .values({ key, value })
      .onConflictDoUpdate({
        target: botSettings.key,
        set: { value, updatedAt: sql`now()` },
      });
  },

  async clearValue(key) {
    await db.delete(botSettings).where(eq(botSettings.key, key));
  },

  async setSecret(key, ciphertext, lastFour) {
    await db
      .insert(botSecrets)
      .values({ key, ciphertext, lastFour })
      .onConflictDoUpdate({
        target: botSecrets.key,
        set: { ciphertext, lastFour, updatedAt: sql`now()` },
      });
  },

  async clearSecret(key) {
    await db.delete(botSecrets).where(eq(botSecrets.key, key));
  },

  async addAudit(key, action) {
    await db.insert(settingsAudit).values({ key, action });
  },

  async audit(limit) {
    return db
      .select({
        key: settingsAudit.key,
        action: settingsAudit.action,
        createdAt: settingsAudit.createdAt,
      })
      .from(settingsAudit)
      .orderBy(desc(settingsAudit.id))
      .limit(limit);
  },
};
