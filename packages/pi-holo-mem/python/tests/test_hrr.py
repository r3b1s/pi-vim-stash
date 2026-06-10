"""Tests for HRR algebra functions (Task 6.8).

Tests encode_atom, bind, unbind, bundle, similarity, encode_text,
phases_to_bytes, bytes_to_phases, encode_fact, and snr_estimate.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent.parent / "python"))
sys.path.insert(0, str(Path(__file__).parent.parent.parent / "python" / "bridge"))

import math

import numpy as np
import pytest

from upstream.holographic import (
    encode_atom,
    bind,
    unbind,
    bundle,
    similarity,
    encode_text,
    encode_fact,
    phases_to_bytes,
    bytes_to_phases,
    snr_estimate,
    _TWO_PI,
)

# Common test dimensions (small for speed, large enough for stable statistics)
SMALL_DIM = 64
DEFAULT_DIM = 256


# ---------------------------------------------------------------------------
# encode_atom
# ---------------------------------------------------------------------------

class TestEncodeAtom:
    """Deterministic phase vector generation."""

    def test_returns_ndarray(self):
        """encode_atom should return a numpy array."""
        v = encode_atom("test", DEFAULT_DIM)
        assert isinstance(v, np.ndarray)

    def test_correct_shape(self):
        """Output shape should match the requested dim."""
        v = encode_atom("test", 512)
        assert v.shape == (512,)

    def test_deterministic(self):
        """Same input should produce identical vectors."""
        v1 = encode_atom("hello", DEFAULT_DIM)
        v2 = encode_atom("hello", DEFAULT_DIM)
        assert np.array_equal(v1, v2)

    def test_different_words_different_vectors(self):
        """Different words should produce different vectors."""
        v1 = encode_atom("hello", SMALL_DIM)
        v2 = encode_atom("world", SMALL_DIM)
        assert not np.array_equal(v1, v2)

    def test_values_in_range(self):
        """Phase values should be in [0, 2π)."""
        v = encode_atom("test", DEFAULT_DIM)
        assert np.all(v >= 0.0)
        assert np.all(v < _TWO_PI)

    def test_float64_dtype(self):
        """Output should be float64."""
        v = encode_atom("test", DEFAULT_DIM)
        assert v.dtype == np.float64

    def test_different_dim_same_word_prefix(self):
        """Different dims should produce different-length vectors."""
        v64 = encode_atom("test", 64)
        v128 = encode_atom("test", 128)
        assert v64.shape == (64,)
        assert v128.shape == (128,)

    def test_requires_numpy(self, monkeypatch):
        """Should raise RuntimeError if numpy is unavailable."""
        import upstream.holographic as hrr_mod
        monkeypatch.setattr(hrr_mod, "_HAS_NUMPY", False)
        with pytest.raises(RuntimeError, match="numpy is required"):
            encode_atom("test", DEFAULT_DIM)


# ---------------------------------------------------------------------------
# bind
# ---------------------------------------------------------------------------

class TestBind:
    """Circular convolution — element-wise phase addition."""

    def test_bind_returns_ndarray(self):
        a = encode_atom("a", SMALL_DIM)
        b = encode_atom("b", SMALL_DIM)
        result = bind(a, b)
        assert isinstance(result, np.ndarray)

    def test_bind_same_shape(self):
        a = encode_atom("a", SMALL_DIM)
        b = encode_atom("b", SMALL_DIM)
        result = bind(a, b)
        assert result.shape == a.shape

    def test_bind_commutative(self):
        a = encode_atom("a", SMALL_DIM)
        b = encode_atom("b", SMALL_DIM)
        assert np.allclose(bind(a, b), bind(b, a))

    def test_bind_associative(self):
        a = encode_atom("a", SMALL_DIM)
        b = encode_atom("b", SMALL_DIM)
        c = encode_atom("c", SMALL_DIM)
        left = bind(bind(a, b), c)
        right = bind(a, bind(b, c))
        assert np.allclose(left, right)

    def test_bind_values_in_range(self):
        a = encode_atom("a", SMALL_DIM)
        b = encode_atom("b", SMALL_DIM)
        result = bind(a, b)
        assert np.all(result >= 0.0)
        assert np.all(result < _TWO_PI)

    def test_bind_dissimilar_to_inputs(self):
        """Bound vector should be dissimilar to both inputs."""
        a = encode_atom("alpha", SMALL_DIM)
        b = encode_atom("beta", SMALL_DIM)
        bound = bind(a, b)
        sim_a = similarity(bound, a)
        sim_b = similarity(bound, b)
        # Random-like vectors have expected similarity ~ 0
        assert abs(sim_a) < 0.4, f"sim(a, bound) = {sim_a}"
        assert abs(sim_b) < 0.4, f"sim(b, bound) = {sim_b}"

    def test_bind_with_zero_phase(self):
        """Binding with zero-phase vector should return the original vector."""
        zero = np.zeros(SMALL_DIM, dtype=np.float64)
        a = encode_atom("a", SMALL_DIM)
        result = bind(a, zero)
        assert np.allclose(result, a)


# ---------------------------------------------------------------------------
# unbind
# ---------------------------------------------------------------------------

class TestUnbind:
    """Circular correlation — element-wise phase subtraction."""

    def test_unbind_inverse_of_bind(self):
        """unbind(bind(a, b), a) should approximately equal b."""
        a = encode_atom("key", SMALL_DIM)
        b = encode_atom("value", SMALL_DIM)
        bound = bind(a, b)
        retrieved = unbind(bound, a)
        assert similarity(retrieved, b) == pytest.approx(1.0, abs=1e-10)

    def test_unbind_values_in_range(self):
        a = encode_atom("a", SMALL_DIM)
        b = encode_atom("b", SMALL_DIM)
        bound = bind(a, b)
        result = unbind(bound, a)
        assert np.all(result >= 0.0)
        assert np.all(result < _TWO_PI)

    def test_unbind_wrong_key(self):
        """Unbinding with wrong key should give dissimilar result."""
        a = encode_atom("key", SMALL_DIM)
        b = encode_atom("value", SMALL_DIM)
        wrong = encode_atom("wrong", SMALL_DIM)
        bound = bind(a, b)
        retrieved = unbind(bound, wrong)
        sim = similarity(retrieved, b)
        assert abs(sim) < 0.4, f"sim = {sim}"

    def test_unbind_same_shape(self):
        a = encode_atom("a", SMALL_DIM)
        b = encode_atom("b", SMALL_DIM)
        bound = bind(a, b)
        result = unbind(bound, a)
        assert result.shape == a.shape


# ---------------------------------------------------------------------------
# bundle
# ---------------------------------------------------------------------------

class TestBundle:
    """Superposition via circular mean."""

    def test_bundle_single(self):
        """Bundling a single vector should return itself."""
        a = encode_atom("a", SMALL_DIM)
        result = bundle(a)
        assert np.allclose(result, a)

    def test_bundle_two_vectors(self):
        a = encode_atom("a", SMALL_DIM)
        b = encode_atom("b", SMALL_DIM)
        result = bundle(a, b)
        assert isinstance(result, np.ndarray)
        assert result.shape == a.shape

    def test_bundle_similar_to_inputs(self):
        """Bundle should be similar to each of its inputs."""
        a = encode_atom("alpha", SMALL_DIM)
        b = encode_atom("beta", SMALL_DIM)
        c = encode_atom("gamma", SMALL_DIM)
        bundled = bundle(a, b, c)
        assert similarity(bundled, a) > 0.3
        assert similarity(bundled, b) > 0.3
        assert similarity(bundled, c) > 0.3

    def test_bundle_commutative(self):
        a = encode_atom("a", SMALL_DIM)
        b = encode_atom("b", SMALL_DIM)
        assert np.allclose(bundle(a, b), bundle(b, a))

    def test_bundle_values_in_range(self):
        a = encode_atom("a", SMALL_DIM)
        b = encode_atom("b", SMALL_DIM)
        result = bundle(a, b)
        assert np.all(result >= 0.0)
        assert np.all(result < _TWO_PI)


# ---------------------------------------------------------------------------
# similarity
# ---------------------------------------------------------------------------

class TestSimilarity:
    """Phase cosine similarity."""

    def test_identical_vectors(self):
        """Similarity of identical vectors should be 1.0."""
        a = encode_atom("test", SMALL_DIM)
        assert similarity(a, a) == pytest.approx(1.0)

    def test_orthogonal_vectors(self):
        """Two independent random atoms should have near-zero similarity."""
        a = encode_atom("alpha", SMALL_DIM)
        b = encode_atom("beta", SMALL_DIM)
        sim = similarity(a, b)
        assert abs(sim) < 0.4, f"sim = {sim}"

    def test_self_similarity_symmetric(self):
        """similarity(a, b) should equal similarity(b, a)."""
        a = encode_atom("a", SMALL_DIM)
        b = encode_atom("b", SMALL_DIM)
        assert similarity(a, b) == pytest.approx(similarity(b, a))

    def test_range(self):
        """Similarity should be in [-1, 1]."""
        a = encode_atom("a", SMALL_DIM)
        b = encode_atom("b", SMALL_DIM)
        c = encode_atom("c", SMALL_DIM)
        for x, y in [(a, a), (a, b), (b, c), (a, bind(b, c))]:
            sim = similarity(x, y)
            assert -1.0 <= sim <= 1.0, f"sim = {sim}"


# ---------------------------------------------------------------------------
# encode_text
# ---------------------------------------------------------------------------

class TestEncodeText:
    """Bag-of-words text encoding."""

    def test_returns_ndarray(self):
        v = encode_text("hello world", SMALL_DIM)
        assert isinstance(v, np.ndarray)

    def test_correct_shape(self):
        v = encode_text("hello world", 256)
        assert v.shape == (256,)

    def test_empty_text(self):
        """Empty text should return the __hrr_empty__ atom."""
        v = encode_text("", DEFAULT_DIM)
        v_empty = encode_atom("__hrr_empty__", DEFAULT_DIM)
        assert similarity(v, v_empty) == pytest.approx(1.0, abs=1e-10)

    def test_different_texts_different_vectors(self):
        """Different texts should produce different vectors."""
        v1 = encode_text("hello world", SMALL_DIM)
        v2 = encode_text("goodbye world", SMALL_DIM)
        assert not np.array_equal(v1, v2)

    def test_same_text_identical(self):
        """Same text should produce identical vectors (deterministic)."""
        v1 = encode_text("hello world", SMALL_DIM)
        v2 = encode_text("hello world", SMALL_DIM)
        assert np.array_equal(v1, v2)

    def test_case_insensitive(self):
        """Text encoding should be case-insensitive (lowercased)."""
        v1 = encode_text("Hello World", SMALL_DIM)
        v2 = encode_text("hello world", SMALL_DIM)
        assert np.allclose(v1, v2)


# ---------------------------------------------------------------------------
# encode_fact
# ---------------------------------------------------------------------------

class TestEncodeFact:
    """Structured fact encoding with entity role binding."""

    def test_returns_ndarray(self):
        v = encode_fact("test content", ["entity1"], SMALL_DIM)
        assert isinstance(v, np.ndarray)

    def test_correct_shape(self):
        v = encode_fact("test content", ["entity1", "entity2"], 128)
        assert v.shape == (128,)

    def test_different_content(self):
        v1 = encode_fact("content A", ["entity1"], SMALL_DIM)
        v2 = encode_fact("content B", ["entity1"], SMALL_DIM)
        assert similarity(v1, v2) < 1.0

    def test_no_entities(self):
        v = encode_fact("test content", [], SMALL_DIM)
        assert isinstance(v, np.ndarray)
        assert v.shape == (SMALL_DIM,)


# ---------------------------------------------------------------------------
# phases_to_bytes / bytes_to_phases roundtrip
# ---------------------------------------------------------------------------

class TestSerialization:
    """Phases-to-bytes and back."""

    def test_roundtrip(self):
        """phases_to_bytes then bytes_to_phases should return the original."""
        original = encode_atom("roundtrip", DEFAULT_DIM)
        data = phases_to_bytes(original)
        restored = bytes_to_phases(data)
        assert np.allclose(original, restored)

    def test_bytes_length(self):
        """1024-dim float64 should produce 8192 bytes."""
        v = encode_atom("size_test", 1024)
        data = phases_to_bytes(v)
        assert len(data) == 8192  # 1024 * 8

    def test_bytes_type(self):
        v = encode_atom("type_test", DEFAULT_DIM)
        data = phases_to_bytes(v)
        assert isinstance(data, bytes)

    def test_restored_is_mutable(self):
        """bytes_to_phases should return a mutable (writable) array."""
        v = encode_atom("mutable_test", SMALL_DIM)
        data = phases_to_bytes(v)
        restored = bytes_to_phases(data)
        restored[0] = 0.0  # should not raise

    def test_different_vectors_roundtrip(self):
        v1 = encode_atom("first", SMALL_DIM)
        v2 = encode_atom("second", SMALL_DIM)
        assert not np.allclose(v1, v2)
        assert np.allclose(v1, bytes_to_phases(phases_to_bytes(v1)))
        assert np.allclose(v2, bytes_to_phases(phases_to_bytes(v2)))


# ---------------------------------------------------------------------------
# snr_estimate
# ---------------------------------------------------------------------------

class TestSNREstimate:
    """Signal-to-noise ratio estimation."""

    def test_returns_float(self):
        snr = snr_estimate(1024, 10)
        assert isinstance(snr, float)

    def test_positive_snr(self):
        snr = snr_estimate(1024, 10)
        assert snr > 0

    def test_infinite_for_zero_items(self):
        snr = snr_estimate(1024, 0)
        assert snr == float("inf")

    def test_negative_items_treated_as_zero(self):
        snr = snr_estimate(1024, -1)
        assert snr == float("inf")

    def test_snr_scales_with_dim(self):
        snr_low = snr_estimate(256, 100)
        snr_high = snr_estimate(1024, 100)
        assert snr_high > snr_low

    def test_snr_decreases_with_more_items(self):
        snr_few = snr_estimate(1024, 10)
        snr_many = snr_estimate(1024, 100)
        assert snr_few > snr_many
