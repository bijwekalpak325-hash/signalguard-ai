import "server-only";

import { Pool } from "pg";

export interface NeonStoreData {
  nextSessionId: number;
  nextDetectionId: number;
  nextTrackId: number;
  nextCandidateId: number;
  nextPriorityId: number;
  sessions: any[];
  settings: {
    processingFps: number;
    confidenceThreshold: number;
    verificationSensitivity: "Low" | "Medium" | "High";
    privacyMode: boolean;
  };
  activeSessionIds: Record<number, number>;
}

const globalForNeon = globalThis as unknown as {
  signalGuardPool?: Pool;
  signalGuardReady?: Promise<void>;
};

function getPool() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not configured");
  }

  if (!globalForNeon.signalGuardPool) {
    globalForNeon.signalGuardPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 3,
      ssl: {
        rejectUnauthorized: false,
      },
    });
  }

  return globalForNeon.signalGuardPool;
}

async function ensureDatabase() {
  if (!globalForNeon.signalGuardReady) {
    globalForNeon.signalGuardReady = (async () => {
      const pool = getPool();

      await pool.query(`
        CREATE TABLE IF NOT EXISTS signalguard_state (
          id INTEGER PRIMARY KEY,
          data JSONB NOT NULL
        )
      `);

      const existing = await pool.query(
        `SELECT id FROM signalguard_state WHERE id = 1`
      );

      if (existing.rowCount === 0) {
        const initial: NeonStoreData = {
          nextSessionId: 1,
          nextDetectionId: 1,
          nextTrackId: 1,
          nextCandidateId: 1,
          nextPriorityId: 1,
          sessions: [],
          settings: {
            processingFps: 2,
            confidenceThreshold: 0.35,
            verificationSensitivity: "Medium",
            privacyMode: false,
          },
          activeSessionIds: {},
        };

        await pool.query(
          `
          INSERT INTO signalguard_state (id, data)
          VALUES (1, $1::jsonb)
          `,
          [JSON.stringify(initial)]
        );
      }
    })();
  }

  await globalForNeon.signalGuardReady;
}

export async function getNeonStore(): Promise<NeonStoreData> {
  await ensureDatabase();

  const result = await getPool().query(
    `SELECT data FROM signalguard_state WHERE id = 1`
  );

  if (result.rowCount === 0) {
    throw new Error("SignalGuard database state was not initialized");
  }

  return result.rows[0].data as NeonStoreData;
}

export async function updateNeonStore<T>(
  mutator: (store: NeonStoreData) => T | Promise<T>
): Promise<T> {
  await ensureDatabase();

  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const result = await client.query(
      `SELECT data FROM signalguard_state WHERE id = 1 FOR UPDATE`
    );

    if (result.rowCount === 0) {
      throw new Error("SignalGuard database state was not initialized");
    }

    const store = result.rows[0].data as NeonStoreData;

    const value = await mutator(store);

    await client.query(
      `
      UPDATE signalguard_state
      SET data = $1::jsonb
      WHERE id = 1
      `,
      [JSON.stringify(store)]
    );

    await client.query("COMMIT");

    return value;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function getNeonSession(id: number) {
  const store = await getNeonStore();

  return store.sessions.find((session) => session.id === id) ?? null;
}