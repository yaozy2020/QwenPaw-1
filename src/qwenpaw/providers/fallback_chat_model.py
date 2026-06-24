# -*- coding: utf-8 -*-
"""Fallback wrapper for ChatModelBase instances.

Transparently falls back to the next model in a chain when the current model
raises an exception.  Both non-streaming and streaming calls are supported:

- **Non-streaming**: each model is tried in order; an exception causes the
  next model to be invoked.  ``asyncio.CancelledError`` is re-raised
  immediately without falling back.  If every model fails the last exception
  is propagated.
- **Streaming**: the first chunk is consumed before committing to the model.
  If the stream raises before the first chunk arrives, the wrapper falls back
  to the next model.  Once the first chunk has been yielded, any further
  exception is propagated directly to the consumer — previously emitted
  content cannot be withdrawn, so silent fallback would produce duplicated or
  out-of-order output.

Typical wrapper stack (outermost last)::

    raw_model -> TokenRecordingModelWrapper -> RetryChatModel -> FallbackChatModel
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any, AsyncGenerator

from agentscope.model import ChatModelBase
from agentscope.model._model_response import ChatResponse

logger = logging.getLogger(__name__)


def _model_key(model: ChatModelBase) -> str:
    """Return a stable human-readable key for *model*."""
    provider_id = getattr(model, "_provider_id", None)
    name = getattr(model, "model_name", "unknown")
    return f"{provider_id}/{name}" if provider_id else name


class FallbackChatModel(ChatModelBase):
    """Ordered fallback chain for :class:`ChatModelBase` instances.

    Attributes:
        models: Ordered list of chat models to try.
        formatter: Optional formatter instance inherited from the primary
            model so upstream code can continue calling ``formatter.format``
            without knowing which model is currently active.
    """

    def __init__(
        self,
        models: list[ChatModelBase],
        formatter: Any | None = None,
    ) -> None:
        if not models:
            raise ValueError("models list must contain at least one ChatModelBase")

        super().__init__(
            model_name=models[0].model_name,
            stream=models[0].stream,
        )
        self._models = list(models)
        self.formatter = formatter

    # ------------------------------------------------------------------
    # Properties
    # ------------------------------------------------------------------
    @property
    def model_key(self) -> str:
        """Stable key for logging: ``provider/model_name``."""
        return _model_key(self._models[0])

    @property
    def models(self) -> list[ChatModelBase]:
        """Expose the inner model chain for inspection/debugging."""
        return list(self._models)

    # ------------------------------------------------------------------
    # __call__
    # ------------------------------------------------------------------
    async def __call__(
        self,
        *args: Any,
        **kwargs: Any,
    ) -> ChatResponse | AsyncGenerator[ChatResponse, None]:
        """Try each model in sequence until one succeeds.

        Non-streaming calls return a :class:`ChatResponse` directly.
        Streaming calls return an :class:`AsyncGenerator` that yields
        :class:`ChatResponse` chunks.
        """
        last_exc: Exception | None = None

        for idx, model in enumerate(self._models):
            next_model = self._models[idx + 1] if idx + 1 < len(self._models) else None
            model_label = _model_key(model)
            next_label = _model_key(next_model) if next_model else "None"

            try:
                result = await model(*args, **kwargs)
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                last_exc = exc
                logger.warning(
                    "Model fallback: '%s' failed with %s: %s. "
                    "Switching to '%s'.",
                    model_label,
                    type(exc).__name__,
                    exc,
                    next_label,
                )
                continue

            # Non-streaming success path.
            if not isinstance(result, AsyncGenerator):
                return result

            # Streaming: consume the first chunk to decide whether to keep
            # this model or fall back.
            try:
                first_chunk = await result.__anext__()
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                last_exc = exc
                logger.warning(
                    "Model fallback: '%s' failed with %s: %s (before first chunk). "
                    "Switching to '%s'.",
                    model_label,
                    type(exc).__name__,
                    exc,
                    next_label,
                )
                # Ensure the failed generator is closed to release resources.
                await result.aclose()
                continue

            # First chunk arrived — wrap the rest of the stream and yield it.
            async def _pass_through() -> AsyncGenerator[ChatResponse, None]:
                yield first_chunk
                try:
                    async for chunk in result:
                        yield chunk
                finally:
                    await result.aclose()

            return _pass_through()

        # All models exhausted.
        if last_exc is not None:
            logger.error(
                "All fallback models exhausted. Last error: %s: %s",
                type(last_exc).__name__,
                last_exc,
            )
            raise last_exc
        # Should not reach here because the list is non-empty, but keep a
        # defensive guard for type-checkers.
        raise RuntimeError("FallbackChatModel: no models available and no exception recorded")


# ---------------------------------------------------------------------------
# Self-check
# ---------------------------------------------------------------------------
async def _run_self_checks() -> None:
    """Run a minimal in-process self-check using mock models."""

    class _MockResponse:
        def __init__(self, text: str = "ok") -> None:
            self.text = text
            self.usage = None

    # Helper to build a simple non-streaming mock model.
    def _make_non_streaming_mock(text: str, raise_on_call: bool = False) -> Any:
        class _MockModel(ChatModelBase):
            def __init__(self) -> None:
                super().__init__(model_name=text, stream=False)
                self._raise = raise_on_call
                self.calls = 0

            async def __call__(self, *args: Any, **kwargs: Any) -> Any:
                self.calls += 1
                if self._raise:
                    raise RuntimeError(f"{text} failed")
                return _MockResponse(text)

        m = _MockModel()
        m._provider_id = "test_provider"  # type: ignore[attr-defined]
        return m

    # Helper to build a simple streaming mock model.
    def _make_streaming_mock(
        chunks: list[str],
        raise_before_first_chunk: bool = False,
        raise_after_first_chunk: bool = False,
    ) -> Any:
        class _MockModel(ChatModelBase):
            def __init__(self) -> None:
                super().__init__(model_name="stream_mock", stream=True)
                self._raise_before = raise_before_first_chunk
                self._raise_after = raise_after_first_chunk
                self.calls = 0

            async def __call__(self, *args: Any, **kwargs: Any) -> Any:
                self.calls += 1
                if self._raise_before:
                    raise RuntimeError("stream failed before first chunk")

                async def _gen() -> AsyncGenerator[ChatResponse, None]:
                    for i, chunk_text in enumerate(chunks):
                        if i > 0 and self._raise_after:
                            raise RuntimeError("stream failed mid-flight")
                        yield ChatResponse(content=[{"type": "text", "text": chunk_text}])

                return _gen()

        m = _MockModel()
        m._provider_id = "test_provider"  # type: ignore[attr-defined]
        return m

    # --- Test 1: non-streaming, first model fails, second succeeds ---
    model_a = _make_non_streaming_mock("model_a", raise_on_call=True)
    model_b = _make_non_streaming_mock("model_b", raise_on_call=False)
    fb = FallbackChatModel([model_a, model_b])

    resp = await fb(messages=[])
    assert resp.text == "model_b", f"Expected 'model_b', got {resp.text!r}"
    assert model_a.calls == 1
    assert model_b.calls == 1
    print("PASS: non-streaming fallback")

    # --- Test 2: all models fail -> raise last exception ---
    model_c = _make_non_streaming_mock("model_c", raise_on_call=True)
    model_d = _make_non_streaming_mock("model_d", raise_on_call=True)
    fb2 = FallbackChatModel([model_c, model_d])

    raised = False
    try:
        await fb2(messages=[])
    except RuntimeError as exc:
        raised = True
        assert "model_d failed" in str(exc)
    assert raised, "Expected RuntimeError to be raised"
    assert model_c.calls == 1
    assert model_d.calls == 1
    print("PASS: all models exhausted raises last exception")

    # --- Test 3: streaming, first chunk before fail -> fallback succeeds ---
    model_e = _make_streaming_mock(
        ["e1", "e2"],
        raise_before_first_chunk=True,
    )
    model_f = _make_streaming_mock(
        ["f1", "f2"],
        raise_before_first_chunk=False,
    )
    fb3 = FallbackChatModel([model_e, model_f])

    chunks: list[str] = []
    stream = await fb3(messages=[])
    assert hasattr(stream, "__aiter__"), f"Expected async generator, got {type(stream)}"
    async for chunk in stream:
        chunks.append(chunk.content[0]["text"])

    assert chunks == ["f1", "f2"], f"Expected ['f1', 'f2'], got {chunks}"
    assert model_e.calls == 1
    assert model_f.calls == 1
    print("PASS: streaming fallback before first chunk")

    # --- Test 4: empty model list raises ValueError ---
    try:
        FallbackChatModel([])
    except ValueError:
        print("PASS: empty model list raises ValueError")
    else:
        raise AssertionError("Expected ValueError for empty model list")

    print("All self-checks passed.")


if __name__ == "__main__":
    asyncio.run(_run_self_checks())
