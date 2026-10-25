from discord_stats.api.cache import BoundedCache


def test_the_least_recently_used_entry_goes_first():
    cache = BoundedCache(2)
    cache.put("a", 1)
    cache.put("b", 2)
    assert cache.get("a") == 1          # a read is a use: `b` is now the coldest
    cache.put("c", 3)
    assert list(cache.snapshot()) == ["a", "c"]


def test_the_weight_budget_evicts_until_a_new_entry_fits():
    cache = BoundedCache(10, max_weight=250)
    for key in "abc":
        cache.put(key, key, weight=100)
    assert list(cache.snapshot()) == ["b", "c"]
    assert cache.weight == 200


def test_replacing_an_entry_does_not_count_its_weight_twice():
    cache = BoundedCache(10, max_weight=1000)
    cache.put("a", "old", weight=400)
    cache.put("a", "new", weight=300)
    assert cache.weight == 300 and cache.get("a") == "new"


def test_an_expired_entry_reads_as_missing_and_is_dropped():
    cache = BoundedCache(10, max_weight=100)
    cache.put("a", "x", expires_at=50.0, weight=10)
    assert cache.get("a", now=49.0) == "x"
    assert cache.get("a", now=50.0) is None
    assert len(cache) == 0 and cache.weight == 0


def test_pop_forgets_an_entry_and_its_weight():
    cache = BoundedCache(10, max_weight=100)
    cache.put("a", "x", weight=40)
    cache.pop("a")
    cache.pop("missing")
    assert cache.snapshot() == {} and cache.weight == 0
