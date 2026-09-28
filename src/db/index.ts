import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS jobs (
  id          TEXT PRIMARY KEY,           -- LinkedIn job id
  title       TEXT NOT NULL,
  company     TEXT,
  location    TEXT,
  url         TEXT NOT NULL,
  posted_at   TEXT,
  description TEXT,
  score       INTEGER,
  status      TEXT CHECK (status IN ('saved','applied','interviewing','offer','rejected','archived')),
  notes       TEXT,
  source      TEXT,                       -- search | post | manual
  source_post TEXT,                       -- posts.id when found via a hiring post
  verdict     TEXT CHECK (verdict IN ('match','reject')),
  verdict_why TEXT,                       -- JSON: rejections + highlights
  evaluated_at INTEGER,
  first_seen  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS posts (
  id          TEXT PRIMARY KEY,           -- activity urn id
  url         TEXT NOT NULL,
  author_id   TEXT,                       -- people.id, null for company pages
  author_name TEXT,
  author_headline TEXT,
  text        TEXT NOT NULL,
  job_id      TEXT,                       -- linked job, if any
  match_why   TEXT,                       -- JSON verdict
  found_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS people (
  id           TEXT PRIMARY KEY,          -- public profile slug (linkedin.com/in/<id>)
  name         TEXT NOT NULL,
  headline     TEXT,
  location     TEXT,
  profile_url  TEXT NOT NULL,
  degree       TEXT,
  search_query TEXT,
  first_seen   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS invites (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  person_id   TEXT NOT NULL REFERENCES people(id),
  note        TEXT,
  follow      INTEGER NOT NULL DEFAULT 0, -- also follow the person when sending
  context     TEXT,                       -- why they were queued (e.g. hiring post url)
  status      TEXT NOT NULL CHECK (status IN ('pending','approved','rejected','sent','failed')),
  error       TEXT,
  created_at  INTEGER NOT NULL,
  decided_at  INTEGER,
  sent_at     INTEGER
);
CREATE INDEX IF NOT EXISTS invites_status ON invites(status);
CREATE INDEX IF NOT EXISTS invites_person ON invites(person_id);

CREATE TABLE IF NOT EXISTS actions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  type       TEXT NOT NULL,               -- invite_sent | page_load | checkpoint | ...
  detail     TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS actions_type_time ON actions(type, created_at);

CREATE TABLE IF NOT EXISTS kv (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

export type Db = DatabaseSync;

/** Opens (and migrates) the database. Pass ":memory:" for tests. */
export function openDb(file: string): Db {
  if (file !== ":memory:") mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  db.exec(SCHEMA);
  return db;
}
