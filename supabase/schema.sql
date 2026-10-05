-- Production storage (replace lib/db.ts JSON store). One row per entity, JSON for nested fields.
create table items   (id text primary key, name text, description text, category text, est_value_usd numeric,
                      value_low numeric, value_high numeric, valuation_notes text, image_url text,
                      acquired_at timestamptz default now(), acquired_from text);
create table venues  (id text primary key, channel text, name text, target text, categories text[], min_value_usd numeric,
                      max_value_usd numeric, cooldown_hours int, permission text, format_hint text,
                      last_posted_at timestamptz, stats jsonb default '{"posts":0,"offers":0,"accepted":0}');
create table posts   (id text primary key, venue_id text references venues, channel text, external_id text, url text,
                      title text, body text, item_id text references items, created_at timestamptz default now());
create table offers  (id text primary key, channel text, venue_id text, post_id text, "from" text, thread_ref text,
                      raw_text text, item_name text, item_description text, photos text[], status text,
                      evaluation jsonb, messages jsonb default '[]', created_at timestamptz default now());
create table trades  (id text primary key, number int, from_item_id text, to_item_id text, offer_id text,
                      counterparty text, channel text, multiplier numeric, rationale text, completed_at timestamptz default now());
create table log     (id text primary key, at timestamptz default now(), kind text, text text, ref text);
create table agent   (id int primary key default 1, goal_usd numeric default 100000, current_item_id text,
                      tick_count int default 0, cursors jsonb default '{}');
-- Public site reads: items, trades, log, venues (stats only). Never expose offers.from / thread_ref publicly.
