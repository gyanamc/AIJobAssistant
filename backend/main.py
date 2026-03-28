import os
import httpx
from fastapi import FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional

app = FastAPI(
    title="AI Job Assistant API",
    description="Backend for AI Job Assistant Chrome extension.",
    version="2.0.0"
)

# Allow requests from Chrome extensions
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["POST", "GET"],
    allow_headers=["*"],
)

# ── Health check ──────────────────────────────────────────────────────────────
@app.get("/")
def health_check():
    return {"status": "ok", "message": "AI Job Assistant backend is live."}

# ── Ollama Proxy ──────────────────────────────────────────────────────────────
OLLAMA_HOST = os.getenv("OLLAMA_HOST", "http://localhost:11434")

class OllamaMessage(BaseModel):
    role: str
    content: str

class OllamaChatRequest(BaseModel):
    model: str = "llama3.2:1b"
    messages: List[OllamaMessage]
    options: Optional[dict] = {"temperature": 0.3}
    stream: bool = False

@app.post("/api/v1/ollama/chat")
async def ollama_chat(request: OllamaChatRequest):
    """
    Proxy endpoint for Ollama. Forwards chat requests to the local Ollama instance.
    The extension calls this when Groq is unavailable, providing a free fallback.
    """
    payload = {
        "model":    request.model,
        "messages": [{"role": m.role, "content": m.content} for m in request.messages],
        "options":  request.options or {"temperature": 0.3},
        "stream":   False
    }

    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            res = await client.post(f"{OLLAMA_HOST}/api/chat", json=payload)

        if res.status_code != 200:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=f"Ollama returned {res.status_code}: {res.text[:200]}"
            )

        data = res.json()
        # Ollama returns: {"message": {"role": "assistant", "content": "..."}}
        content = data.get("message", {}).get("content", "")
        return {"content": content}

    except httpx.ConnectError:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Ollama service unavailable. Make sure Ollama is running."
        )
    except httpx.TimeoutException:
        raise HTTPException(
            status_code=status.HTTP_504_GATEWAY_TIMEOUT,
            detail="Ollama request timed out."
        )
