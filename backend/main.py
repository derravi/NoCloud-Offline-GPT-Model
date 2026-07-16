"""
main.py
FastAPI backend for the Local ChatGPT app.

Responsibilities:
 - List locally installed Ollama models
 - Create / list / rename / delete conversations
 - Stream chat completions from Ollama and persist them to SQLite
 - Serve the frontend (static files)

Run with:  uvicorn main:app --host 0.0.0.0 --port 8000
(see README_SETUP.txt in the project root for full instructions)
"""

import json
import os
import re

import httpx
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

import database as db

OLLAMA_HOST = os.environ.get("OLLAMA_HOST", "http://localhost:11434")
IMAGE_MARKDOWN_RE = re.compile(r"!\[[^\]]*\]\(data:image/[^)]+\)")


def strip_embedded_images(text: str) -> str:
    """Replace embedded base64 image markdown with a short placeholder.

    Images are sent to Ollama via the dedicated 'images' field, so we don't
    want to also ship the (often huge) base64 string as plain text — that
    would bloat every subsequent request in the conversation.
    """
    cleaned = IMAGE_MARKDOWN_RE.sub("[image attached]", text)
    return cleaned.strip() or "[image attached]"
FRONTEND_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "frontend")

app = FastAPI(title="Local ChatGPT")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

db.init_db()


# ---------------------------------------------------------------------------
# Request/response models
# ---------------------------------------------------------------------------

class NewConversation(BaseModel):
    model: str
    title: str = "New chat"
    system_prompt: str = ""


class RenameConversation(BaseModel):
    title: str


class ModelChange(BaseModel):
    model: str


class ChatRequest(BaseModel):
    conversation_id: str
    message: str
    model: str
    images: list[str] | None = None  # base64-encoded image data (no data: prefix), for vision models


# ---------------------------------------------------------------------------
# Models (proxy to Ollama)
# ---------------------------------------------------------------------------

@app.get("/api/models")
async def list_models():
    """Return the list of models currently pulled into the local Ollama instance."""
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(f"{OLLAMA_HOST}/api/tags")
            resp.raise_for_status()
            data = resp.json()
            models = [
                {
                    "name": m["name"],
                    "size": m.get("size"),
                    "parameter_size": m.get("details", {}).get("parameter_size"),
                    "family": m.get("details", {}).get("family"),
                }
                for m in data.get("models", [])
            ]
            return {"models": models}
    except httpx.ConnectError:
        raise HTTPException(
            status_code=503,
            detail=(
                f"Could not reach Ollama at {OLLAMA_HOST}. "
                "Make sure 'ollama serve' is running."
            ),
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


# ---------------------------------------------------------------------------
# Conversations
# ---------------------------------------------------------------------------

@app.get("/api/conversations")
def get_conversations():
    return {"conversations": db.list_conversations()}


@app.post("/api/conversations")
def create_conversation(payload: NewConversation):
    conv = db.create_conversation(payload.model, payload.title, payload.system_prompt)
    return conv


@app.get("/api/conversations/{conv_id}")
def get_conversation(conv_id: str):
    conv = db.get_conversation(conv_id)
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")
    messages = db.get_messages(conv_id)
    return {**conv, "messages": messages}


@app.put("/api/conversations/{conv_id}")
def rename_conversation(conv_id: str, payload: RenameConversation):
    if not db.get_conversation(conv_id):
        raise HTTPException(status_code=404, detail="Conversation not found")
    db.rename_conversation(conv_id, payload.title)
    return {"ok": True}


@app.put("/api/conversations/{conv_id}/model")
def change_conversation_model(conv_id: str, payload: ModelChange):
    if not db.get_conversation(conv_id):
        raise HTTPException(status_code=404, detail="Conversation not found")
    db.set_conversation_model(conv_id, payload.model)
    return {"ok": True}


@app.delete("/api/conversations/{conv_id}")
def delete_conversation(conv_id: str):
    if not db.get_conversation(conv_id):
        raise HTTPException(status_code=404, detail="Conversation not found")
    db.delete_conversation(conv_id)
    return {"ok": True}


# ---------------------------------------------------------------------------
# Chat (streaming)
# ---------------------------------------------------------------------------

@app.post("/api/chat")
async def chat(payload: ChatRequest):
    conv = db.get_conversation(payload.conversation_id)
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")

    # Save the user's message right away
    db.add_message(payload.conversation_id, "user", payload.message)

    # Auto-title new conversations from the first message
    existing = db.get_messages(payload.conversation_id)
    if len([m for m in existing if m["role"] == "user"]) == 1:
        clean_message = strip_embedded_images(payload.message)
        auto_title = clean_message.strip().splitlines()[0][:48]
        if auto_title:
            db.rename_conversation(payload.conversation_id, auto_title)

    # Build full message history for Ollama
    history = db.get_messages(payload.conversation_id)
    ollama_messages = []
    if conv.get("system_prompt"):
        ollama_messages.append({"role": "system", "content": conv["system_prompt"]})
    ollama_messages.extend(
        {"role": m["role"], "content": strip_embedded_images(m["content"])} for m in history
    )

    # If the user attached images to this turn, pass them to Ollama on the
    # most recent user message (only vision-capable models use this field;
    # others simply ignore it).
    if payload.images:
        for msg in reversed(ollama_messages):
            if msg["role"] == "user":
                msg["images"] = payload.images
                break

    async def stream_and_save():
        full_reply = []
        try:
            async with httpx.AsyncClient(timeout=None) as client:
                async with client.stream(
                    "POST",
                    f"{OLLAMA_HOST}/api/chat",
                    json={
                        "model": payload.model,
                        "messages": ollama_messages,
                        "stream": True,
                    },
                ) as resp:
                    if resp.status_code != 200:
                        err = await resp.aread()
                        yield json.dumps({"error": err.decode(errors="ignore")}) + "\n"
                        return
                    async for line in resp.aiter_lines():
                        if not line:
                            continue
                        chunk = json.loads(line)
                        content = chunk.get("message", {}).get("content", "")
                        if content:
                            full_reply.append(content)
                            yield json.dumps({"content": content}) + "\n"
                        if chunk.get("done"):
                            break
        except httpx.ConnectError:
            yield json.dumps(
                {"error": f"Could not reach Ollama at {OLLAMA_HOST}. Is 'ollama serve' running?"}
            ) + "\n"
            return
        except Exception as exc:
            yield json.dumps({"error": str(exc)}) + "\n"
            return
        finally:
            if full_reply:
                db.add_message(payload.conversation_id, "assistant", "".join(full_reply))

    return StreamingResponse(stream_and_save(), media_type="application/x-ndjson")


# ---------------------------------------------------------------------------
# Frontend
# ---------------------------------------------------------------------------

app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")
