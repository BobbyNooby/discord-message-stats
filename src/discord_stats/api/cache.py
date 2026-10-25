"""One bounded, thread-safe cache for the API's in-process memory.

The thumbnail bodies, the thumbnail refusals and the word periods each kept a
hand-written dict with its own eviction loop and its own lock; this is the one
they share now.
"""

from __future__ import annotations

import threading
from typing import Any, Hashable


class BoundedCache:
    """A map that forgets its least recently used entries past its limits.

    ``max_entries`` bounds the count and ``max_weight`` (optional) bounds what
    the entries weigh, so a cache of images can be held to a byte budget. An
    entry may also expire: ``get`` is handed the caller's ``now`` rather than
    reading a clock here, so the clock stays the caller's to control.

    Every read and write takes one lock. The endpoints run on worker threads,
    and a store is a read-modify-write of the map and its running weight: two
    landing together would otherwise evict one entry twice and the total drift.
    """

    def __init__(self, max_entries: int, max_weight: int | None = None) -> None:
        self.max_entries = max_entries
        self.max_weight = max_weight
        # Insertion-ordered, so the front is the least recently used entry.
        self._items: dict[Hashable, tuple[Any, float | None, int]] = {}
        self._weight = 0
        self._lock = threading.Lock()

    def get(self, key: Hashable, now: float | None = None) -> Any | None:
        """The value, or ``None`` when absent or expired. A hit counts as a use."""
        with self._lock:
            entry = self._items.get(key)
            if entry is None:
                return None
            _value, expires_at, _weight = entry
            if expires_at is not None and now is not None and expires_at <= now:
                self._drop(key)
                return None
            self._items[key] = self._items.pop(key)
            return entry[0]

    def put(self, key: Hashable, value: Any, *, expires_at: float | None = None,
            weight: int = 0) -> None:
        """Store ``value``, evicting the coldest entries until it fits."""
        with self._lock:
            self._drop(key)
            while self._items and (
                len(self._items) >= self.max_entries
                or (self.max_weight is not None and self._weight + weight > self.max_weight)
            ):
                self._drop(next(iter(self._items)))
            self._items[key] = (value, expires_at, weight)
            self._weight += weight

    def pop(self, key: Hashable) -> None:
        with self._lock:
            self._drop(key)

    def snapshot(self) -> dict[Hashable, Any]:
        """The values, coldest first: for a status line or a test, not the hot path."""
        with self._lock:
            return {key: entry[0] for key, entry in self._items.items()}

    @property
    def weight(self) -> int:
        with self._lock:
            return self._weight

    def __len__(self) -> int:
        with self._lock:
            return len(self._items)

    def _drop(self, key: Hashable) -> None:
        entry = self._items.pop(key, None)
        if entry is not None:
            self._weight -= entry[2]
