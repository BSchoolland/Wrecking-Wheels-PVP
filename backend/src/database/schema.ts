/**
 * Database Schema using Drizzle ORM
 * SQLite schema for player data, contraptions, and stats
 */

import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  username: text('username').notNull().unique(),
  email: text('email').notNull().unique(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  lastLogin: integer('last_login', { mode: 'timestamp' }),
});

export const contraptions = sqliteTable('contraptions', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id),
  name: text('name').notNull(),
  data: text('data').notNull(), // JSON serialized contraption blueprint
  cost: integer('cost').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

export const matches = sqliteTable('matches', {
  id: text('id').primaryKey(),
  player1Id: text('player1_id').notNull().references(() => users.id),
  player2Id: text('player2_id').notNull().references(() => users.id),
  winnerId: text('winner_id').references(() => users.id),
  duration: real('duration'), // seconds
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  completedAt: integer('completed_at', { mode: 'timestamp' }),
});

export const playerStats = sqliteTable('player_stats', {
  userId: text('user_id').primaryKey().references(() => users.id),
  wins: integer('wins').notNull().default(0),
  losses: integer('losses').notNull().default(0),
  totalMatches: integer('total_matches').notNull().default(0),
  totalPlayTime: real('total_play_time').notNull().default(0), // seconds
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

export const friendships = sqliteTable('friendships', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id),
  friendId: text('friend_id').notNull().references(() => users.id),
  status: text('status').notNull(), // 'pending', 'accepted', 'blocked'
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});
