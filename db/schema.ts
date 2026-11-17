import {
  sqliteTable,
  text,
  integer,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
export const carryWorlds = sqliteTable(
  "carry_worlds_v2",
  {
    id: text("id").primaryKey(),
    code: text("code").notNull(),
    revision: integer("revision").notNull(),
    state: text("state").notNull(),
  },
  (t) => [uniqueIndex("carry_worlds_v2_code_unique").on(t.code)],
);
