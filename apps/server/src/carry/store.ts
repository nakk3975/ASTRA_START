import type { Pool } from "pg";
import type {
  CarryStore,
  Save,
} from "../../../../packages/carry-core/src/service.ts";
export class PgCarryStore implements CarryStore {
  constructor(private pool: Pool) {}
  async migrate() {
    await this.pool.query(
      `CREATE TABLE IF NOT EXISTS carry_worlds_v2 (id uuid PRIMARY KEY, code text NOT NULL UNIQUE, revision bigint NOT NULL, state jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())`,
    );
  }
  async create(s: Save) {
    await this.pool.query(
      "INSERT INTO carry_worlds_v2(id,code,revision,state) VALUES($1,$2,$3,$4)",
      [s.id, s.code, s.revision, s],
    );
  }
  async get(id: string): Promise<Save | null> {
    const r = await this.pool.query(
      "SELECT state FROM carry_worlds_v2 WHERE id=$1",
      [id],
    );
    return r.rows[0]?.state ?? null;
  }
  async byCode(code: string): Promise<Save | null> {
    const r = await this.pool.query(
      "SELECT state FROM carry_worlds_v2 WHERE code=$1",
      [code],
    );
    return r.rows[0]?.state ?? null;
  }
  async cas(s: Save, expected: number) {
    const r = await this.pool.query(
      "UPDATE carry_worlds_v2 SET state=$2,revision=$3,updated_at=now() WHERE id=$1 AND revision=$4",
      [s.id, s, s.revision, expected],
    );
    return r.rowCount === 1;
  }
}
