-- Migration: 002_add_user_preferences
-- Add preferences column for user addon configuration

ALTER TABLE users ADD COLUMN preferences TEXT DEFAULT NULL;
