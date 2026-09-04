"""A tiny offline model, so the example runs with no API key and no network.

It streams one of three canned answers, picked by keyword from the question, word by word with
a small delay. Nothing here is adgate-specific: it exists only so the example has something to
generate while the gateway decides. app/model.py picks the real provider when OPENAI_API_KEY is
set and this one otherwise.

The three answers are the ones examples/nextjs-chat uses, so the same questions produce the
same demo in both examples.
"""

from __future__ import annotations

import asyncio
import re
from collections.abc import AsyncIterator

DEVTOOLS_ANSWER = (
    "For a side project, start with a managed Postgres on a free tier: you get backups, "
    "connection pooling and a connection string in about a minute, and nothing to patch. "
    "Keep migrations in version control from day one, and only move to a self-hosted instance "
    "when the free tier stops fitting."
)

HEALTH_ANSWER = (
    "I am not able to give medical advice. Symptoms like these are worth describing to a "
    "clinician, who can ask the follow-up questions that actually narrow it down. If it came on "
    "suddenly or is getting worse, treat that as a reason to be seen sooner rather than later."
)

GENERIC_ANSWER = (
    "Here is the short version: write down the constraint that actually matters, pick the "
    "simplest option that satisfies it, and keep the decision reversible. Most of the time the "
    "boring choice is the one you will still be happy with in six months."
)

DEVTOOLS_KEYWORDS = (
    "postgres",
    "postgresql",
    "database",
    "db",
    "sql",
    "supabase",
    "neon",
    "hosting",
    "deploy",
    "devtools",
)

#: Deliberately overlapping with the gateway's own health keyword list
#: (packages/core/src/classify/rules/data/sensitive/health.ts), so the canned answer and the
#: sensitive_category:health suppression line up in the demo.
HEALTH_KEYWORDS = (
    "health",
    "doctor",
    "clinic",
    "symptom",
    "symptoms",
    "headache",
    "migraine",
    "fever",
    "medical",
    "medication",
    "therapy",
    "diagnosis",
    "pain",
)


def _has_keyword(text: str, keywords: tuple[str, ...]) -> bool:
    return any(re.search(rf"\b{re.escape(keyword)}\b", text) for keyword in keywords)


def answer_for(question: str) -> str:
    """Which canned answer this question gets. Health wins, so the demo never sells to it."""
    text = question.lower()
    if _has_keyword(text, HEALTH_KEYWORDS):
        return HEALTH_ANSWER
    if _has_keyword(text, DEVTOOLS_KEYWORDS):
        return DEVTOOLS_ANSWER
    return GENERIC_ANSWER


def chunks_of(answer: str) -> list[str]:
    """Words plus their trailing space, so joining the chunks reproduces the answer exactly."""
    words = answer.split(" ")
    return [word if index == len(words) - 1 else f"{word} " for index, word in enumerate(words)]


async def stream_mock_answer(question: str, chunk_delay_ms: int) -> AsyncIterator[str]:
    """Yield the canned answer word by word. A 0 ms delay still yields to the event loop."""
    for chunk in chunks_of(answer_for(question)):
        await asyncio.sleep(chunk_delay_ms / 1000)
        yield chunk


__all__ = [
    "DEVTOOLS_ANSWER",
    "DEVTOOLS_KEYWORDS",
    "GENERIC_ANSWER",
    "HEALTH_ANSWER",
    "HEALTH_KEYWORDS",
    "answer_for",
    "chunks_of",
    "stream_mock_answer",
]
