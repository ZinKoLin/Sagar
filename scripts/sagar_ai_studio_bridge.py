"""Loopback OpenAI-compatible adapter for a visible AI Studio browser."""

import asyncio
import argparse
import hmac
import json
import os
import re
import secrets
import time
from contextlib import asynccontextmanager
from pathlib import Path
from urllib.parse import urlparse
from uuid import uuid4

from starlette.applications import Starlette
from starlette.responses import JSONResponse, StreamingResponse
from starlette.routing import Route

STUDIO = "https://aistudio.google.com/prompts/new_chat"
MODEL = "ai-studio"
HOST, PORT = "127.0.0.1", 8765
MAX_BODY = 1024 * 1024
COMPOSER = 'ms-prompt-input textarea:visible, textarea[placeholder*="prompt" i]:visible'
TURNS = 'ms-chat-turn:not(.thought-activity-host):has(ms-cmark-node.cmark-node:not(.user-chunk))'
ANSWER = 'ms-cmark-node.cmark-node:not(.user-chunk)'


class BridgeError(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status


def messages_from(body):
    if not isinstance(body, dict) or body.get("model") != MODEL:
        raise BridgeError(400, f"Select model {MODEL}.")
    messages = body.get("messages")
    if not isinstance(messages, list):
        raise BridgeError(400, "Expected a messages array.")
    instructions, prompts = [], []
    for message in messages:
        if not isinstance(message, dict) or not isinstance(message.get("content"), str):
            raise BridgeError(400, "Only text messages are supported.")
        role = message.get("role")
        if role == "system":
            instructions.append(message["content"])
        elif role == "user":
            prompts.append(message["content"])
        else:
            raise BridgeError(400, "Only system and user roles are supported.")
    if not prompts or not any(prompt.strip() for prompt in prompts):
        raise BridgeError(400, "A nonempty user message is required.")
    return "\n\n".join(instructions), "\n\n".join(prompts)


class Studio:
    def __init__(self, page):
        self.page = page
        self.stage = "starting browser request"

    async def generate(self, instructions, prompt):
        from playwright.async_api import TimeoutError as BrowserTimeout

        page = self.page
        self.stage = "opening a new AI Studio prompt"
        if urlparse(page.url).hostname == "accounts.google.com":
            raise BridgeError(503, "Finish signing in to Google in the bridge browser, then retry.")
        await page.goto(STUDIO, wait_until="domcontentloaded", timeout=25000)
        if urlparse(page.url).hostname != "aistudio.google.com":
            raise BridgeError(503, "Finish signing in to Google in the bridge browser, then retry.")
        composer = page.locator(COMPOSER).last
        try:
            await composer.wait_for(timeout=12000)
        except BrowserTimeout as exc:
            raise BridgeError(503, "Open the bridge browser and sign in to AI Studio. If already signed in, check the Studio page layout.") from exc

        if instructions:
            self.stage = "opening system instructions"
            panel = page.get_by_role("textbox", name="System instructions", exact=True)
            if not await panel.first.is_visible():
                toggle = page.get_by_role("button", name="System instructions")
                if not await toggle.count():
                    toggle = page.get_by_text("System instructions", exact=True)
                await toggle.first.click(timeout=15000)
                panel = page.get_by_role("textbox", name="System instructions", exact=True)
            self.stage = "filling system instructions"
            await panel.first.fill(instructions, timeout=15000)
            self.stage = "closing system instructions"
            close = page.get_by_role("button", name="Close panel", exact=True)
            if await close.count():
                await close.click(timeout=3000)

        previous = await page.locator(TURNS).count()
        self.stage = "filling the prompt"
        await composer.fill(prompt, timeout=6000)
        self.stage = "pressing Run"
        run = page.get_by_role("button", name=re.compile(r"^Run(?:\s|$)"))
        await run.click(timeout=10000)
        self.stage = "waiting for the completed response"
        turn = page.locator(TURNS).nth(previous)
        answer = turn.locator(ANSWER).first
        stop = page.get_by_role("button", name=re.compile(r"^Stop(?:\s|$)", re.I)).first
        error = page.get_by_role("alert").filter(
            has_text=re.compile(r"quota|rate limit|failed|error", re.I)
        ).first
        while True:
            if await error.is_visible():
                raise BridgeError(502, "AI Studio reported a generation error. Check the browser.")
            generating = await stop.is_visible()
            ready = page.get_by_text("Response ready.", exact=True)
            if (not generating and await answer.is_visible()
                    and await ready.count()):
                result = await answer.inner_text()
                if result.strip():
                    return result
            await asyncio.sleep(0.25)


def response_payload(result, stream):
    info = {"id": f"chatcmpl-{uuid4().hex}", "created": int(time.time()), "model": MODEL}
    if not stream:
        return JSONResponse({**info, "object": "chat.completion", "choices": [
            {"index": 0, "message": {"role": "assistant", "content": result}, "finish_reason": "stop"}
        ]})

    async def events():
        for delta, finish in (({"role": "assistant", "content": result}, None), ({}, "stop")):
            chunk = {**info, "object": "chat.completion.chunk", "choices": [
                {"index": 0, "delta": delta, "finish_reason": finish}
            ]}
            yield f"data: {json.dumps(chunk, ensure_ascii=False)}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(events(), media_type="text/event-stream")


def create_app(token, lifespan=None, studio=None):
    lock = asyncio.Lock()

    def authorize(request):
        supplied = request.headers.get("authorization", "")
        if not hmac.compare_digest(supplied.encode(), f"Bearer {token}".encode()):
            raise BridgeError(401, "Use the bridge key printed in its terminal.")

    async def models(request):
        authorize(request)
        return JSONResponse({"object": "list", "data": [
            {"id": MODEL, "object": "model", "owned_by": "local-bridge"}
        ]})

    async def completions(request):
        authorize(request)
        raw = bytearray()
        async for chunk in request.stream():
            if len(raw) + len(chunk) > MAX_BODY:
                raise BridgeError(413, "Request is too large.")
            raw.extend(chunk)
        try:
            body = json.loads(raw)
        except (ValueError, UnicodeError) as exc:
            raise BridgeError(400, "Invalid JSON request.") from exc
        instructions, prompt = messages_from(body)
        if lock.locked():
            raise BridgeError(429, "AI Studio is busy. Retry after the current response.")
        async with lock:
            try:
                async with asyncio.timeout(29 * 60):
                    task = asyncio.create_task(request.app.state.studio.generate(instructions, prompt))
                    try:
                        while not task.done():
                            if await request.is_disconnected():
                                raise BridgeError(499, "Client disconnected.")
                            await asyncio.sleep(0.15)
                        result = task.result()
                    finally:
                        if not task.done():
                            task.cancel()
                            await asyncio.gather(task, return_exceptions=True)
            except TimeoutError as exc:
                raise BridgeError(504, "AI Studio did not finish in time.") from exc
            except BridgeError:
                raise
            except Exception as exc:
                stage = getattr(request.app.state.studio, "stage", "browser interaction")
                print(f"AI Studio bridge failed at {stage}: {type(exc).__name__}", flush=True)
                raise BridgeError(502, f"AI Studio failed while {stage} ({type(exc).__name__}). Check the bridge browser and retry.") from exc
        return response_payload(result, body.get("stream") is True)

    async def failure(request, exc):
        return JSONResponse({"error": {"message": str(exc), "type": "bridge_error"}}, status_code=exc.status)

    app = Starlette(
        routes=[Route("/v1/models", models), Route("/v1/chat/completions", completions, methods=["POST"])],
        exception_handlers={BridgeError: failure},
        lifespan=lifespan,
    )
    app.state.studio = studio
    return app


def main():
    import uvicorn
    from camoufox.async_api import AsyncCamoufox

    root = Path(os.environ.get("LOCALAPPDATA") or Path.home()) / "SagarAIStudioBridge"
    root.mkdir(parents=True, exist_ok=True)
    key_path = root / "bridge.key"
    try:
        with key_path.open("x", encoding="ascii") as handle:
            handle.write(secrets.token_urlsafe(32))
    except FileExistsError:
        pass
    token = key_path.read_text(encoding="ascii").strip()
    if not token:
        raise RuntimeError("The local bridge key file is empty.")

    @asynccontextmanager
    async def browser(app):
        async with AsyncCamoufox(headless=False, persistent_context=True,
                                user_data_dir=str(root / "browser")) as context:
            page = context.pages[0] if context.pages else await context.new_page()
            await page.goto(STUDIO, wait_until="domcontentloaded", timeout=25000)
            app.state.studio = Studio(page)
            print(f"Sagar URL: http://{HOST}:{PORT}/v1 | Model: {MODEL}", flush=True)
            print(f"Local API key file: {key_path}", flush=True)
            yield

    uvicorn.run(create_app(token, lifespan=browser), host=HOST, port=PORT, access_log=False)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check-installation", action="store_true",
                        help="Check bundled Python dependencies without opening a browser.")
    args = parser.parse_args()
    if args.check_installation:
        from camoufox.async_api import AsyncCamoufox
        import language_tags
        print("AI Studio bridge runtime is ready.")
    else:
        main()
