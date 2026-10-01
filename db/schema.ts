import { sqliteTable, integer, text } from 'drizzle-orm/sqlite-core';
export const readerEvents = sqliteTable('reader_events', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  receivedAt: text('received_at').notNull(),
  payload: text('payload').notNull(),
});

export const readerHeartbeats = sqliteTable('reader_heartbeats', {
  readerKey: text('reader_key').primaryKey(),
  receivedAt: text('received_at').notNull(),
  previousAt: text('previous_at'),
  payload: text('payload').notNull(),
});
export const writerCommands = sqliteTable('writer_commands', {
 requestId: text('request_id').primaryKey(),
 createdAt: text('created_at').notNull(),
 status: text('status').notNull(),
 payload: text('payload').notNull(),
 result: text('result'),
});
export const writerBridge = sqliteTable('writer_bridge', {
 id: integer('id').primaryKey(),
 lastSeen: text('last_seen').notNull(),
});
