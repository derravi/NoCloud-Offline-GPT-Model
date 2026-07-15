"""
database.py
Local SQLite storage layer for the chat app.
Everything lives in a single file: chat_history.db (created next to this script,
unless overridden by the DB_PATH environment variable).
"""

import sqlite3
import os
import time
import uuid
from contextlib import contextmanager

DB_PATH = os.environ.get(
    "DB_PATH",
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "chat_history.db"),
)


def _now() -> float:
    return time.time()


@contextmanager
def get_conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def init_db():
    with get_conn() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS conversations (
                id          TEXT PRIMARY KEY,
                title       TEXT NOT NULL DEFAULT 'New chat',
                model       TEXT NOT NULL,
                system_prompt TEXT DEFAULT '',
                created_at  REAL NOT NULL,
                updated_at  REAL NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS messages (
                id              TEXT PRIMARY KEY,
                conversation_id TEXT NOT NULL,
                role            TEXT NOT NULL,       -- 'user' | 'assistant' | 'system'
                content         TEXT NOT NULL,
                created_at      REAL NOT NULL,
                FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
            )
            """
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id)"
        )


# ---------------------------------------------------------------------------
# Conversations
# ---------------------------------------------------------------------------

def create_conversation(model: str, title: str = "New chat", system_prompt: str = "") -> dict:
    conv_id = str(uuid.uuid4())
    now = _now()
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO conversations (id, title, model, system_prompt, created_at, updated_at) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (conv_id, title, model, system_prompt, now, now),
        )
    return {"id": conv_id, "title": title, "model": model, "created_at": now, "updated_at": now}


def list_conversations() -> list:
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT id, title, model, created_at, updated_at FROM conversations "
            "ORDER BY updated_at DESC"
        ).fetchall()
        return [dict(r) for r in rows]


def get_conversation(conv_id: str) -> dict | None:
    with get_conn() as conn:
        row = conn.execute(
            "SELECT id, title, model, system_prompt, created_at, updated_at "
            "FROM conversations WHERE id = ?",
            (conv_id,),
        ).fetchone()
        return dict(row) if row else None


def rename_conversation(conv_id: str, title: str):
    with get_conn() as conn:
        conn.execute(
            "UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?",
            (title, _now(), conv_id),
        )


def set_conversation_model(conv_id: str, model: str):
    with get_conn() as conn:
        conn.execute(
            "UPDATE conversations SET model = ?, updated_at = ? WHERE id = ?",
            (model, _now(), conv_id),
        )


def touch_conversation(conv_id: str):
    with get_conn() as conn:
        conn.execute(
            "UPDATE conversations SET updated_at = ? WHERE id = ?", (_now(), conv_id)
        )


def delete_conversation(conv_id: str):
    with get_conn() as conn:
        conn.execute("DELETE FROM messages WHERE conversation_id = ?", (conv_id,))
        conn.execute("DELETE FROM conversations WHERE id = ?", (conv_id,))


# ---------------------------------------------------------------------------
# Messages
# ---------------------------------------------------------------------------

def add_message(conv_id: str, role: str, content: str) -> dict:
    msg_id = str(uuid.uuid4())
    now = _now()
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO messages (id, conversation_id, role, content, created_at) "
            "VALUES (?, ?, ?, ?, ?)",
            (msg_id, conv_id, role, content, now),
        )
        conn.execute(
            "UPDATE conversations SET updated_at = ? WHERE id = ?", (now, conv_id)
        )
    return {"id": msg_id, "role": role, "content": content, "created_at": now}


def get_messages(conv_id: str) -> list:
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT id, role, content, created_at FROM messages "
            "WHERE conversation_id = ? ORDER BY created_at ASC",
            (conv_id,),
        ).fetchall()
        return [dict(r) for r in rows]
