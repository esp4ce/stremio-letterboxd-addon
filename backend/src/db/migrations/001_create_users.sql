-- Migration: 001_create_users
-- Create users table for storing Letterboxd authentication data

CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    letterboxd_id TEXT NOT NULL UNIQUE,
    letterboxd_username TEXT NOT NULL,
    letterboxd_display_name TEXT,
    encrypted_refresh_token TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    last_login_at TEXT DEFAULT (datetime('now')),
    token_expires_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_users_letterboxd_id ON users(letterboxd_id);
