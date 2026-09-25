"""Polyline and spline helpers. Coordinates are Three.js local: x east, y up, z south, meters."""
import numpy as np

UP = np.array([0.0, 1.0, 0.0])


def _as_pts(pts):
    P = np.asarray(pts, dtype=np.float64)
    if P.ndim != 2 or P.shape[1] != 3:
        raise ValueError("points must be (N,3)")
    return P


def cumulative_lengths(P, closed=False):
    """Arc length at each vertex; for closed polylines a final entry adds the closing segment."""
    Q = np.vstack([P, P[:1]]) if closed else P
    seg = np.linalg.norm(np.diff(Q, axis=0), axis=1)
    return np.concatenate([[0.0], np.cumsum(seg)])


def polyline_length(pts, closed=False):
    return float(cumulative_lengths(_as_pts(pts), closed)[-1])


def resample(pts, step=2.0, closed=False):
    """Resample a polyline at a fixed arc-length step. Returns (P, S): points and their arc length.

    Closed polylines omit the duplicate end point; the last sample sits just before wrapping."""
    P = _as_pts(pts)
    L = cumulative_lengths(P, closed)
    Q = np.vstack([P, P[:1]]) if closed else P
    total = L[-1]
    n = int(np.floor(total / step)) + (0 if closed else 1)
    S = np.arange(n) * step
    if not closed and S[-1] < total - 1e-6:
        S = np.append(S, total)
    # A tail shorter than half a step reads as a kink: the last tangent is taken over a few
    # centimetres and the finish looks like a hairpin. Fold it into the previous segment instead.
    if not closed and len(S) > 2 and S[-1] - S[-2] < step / 2:
        S = np.delete(S, -2)
    if closed and len(S) > 2 and total - S[-1] < step / 2:
        S = S[:-1]
    out = np.empty((len(S), 3))
    for k in range(3):
        out[:, k] = np.interp(S, L, Q[:, k])
    return out, S


def tangents(P, closed=False):
    """Unit forward vectors, central differences (wrapping when closed)."""
    if closed:
        d = np.roll(P, -1, axis=0) - np.roll(P, 1, axis=0)
    else:
        d = np.gradient(P, axis=0)
    n = np.linalg.norm(d, axis=1, keepdims=True)
    n[n == 0] = 1.0
    return d / n


def rights(T):
    """Unit right-hand vectors on the ground plane: facing east, right is south."""
    r = np.cross(T, UP)
    n = np.linalg.norm(r, axis=1, keepdims=True)
    n[n == 0] = 1.0
    return r / n


def curvature(P, S, closed=False):
    """Unsigned curvature |dT/ds| per point."""
    T = tangents(P, closed)
    if closed:
        dT = np.roll(T, -1, axis=0) - np.roll(T, 1, axis=0)
        ds = (np.roll(S, -1) - np.roll(S, 1))
        total = S[-1] + (S[1] - S[0] if len(S) > 1 else 0)
        ds[0] += total
        ds[-1] += total
    else:
        dT = np.gradient(T, axis=0)
        ds = np.gradient(S)
    ds[ds == 0] = 1.0
    return np.linalg.norm(dT, axis=1) / np.abs(ds)


def project(P, S, x, z, closed=False, hint=None, window=100):
    """Project a ground point onto the polyline. Returns (s, lateral, index).

    lateral is positive on the right-hand side. With a hint index only nearby segments are searched,
    which is what keeps hairpins from snapping to the neighbouring leg."""
    n = len(P)
    if hint is None:
        idx = np.arange(n if closed else n - 1)
    else:
        lo, hi = hint - window, hint + window
        idx = (np.arange(lo, hi) % n) if closed else np.clip(np.arange(lo, hi), 0, n - 2)
        idx = np.unique(idx)
    a = P[idx][:, [0, 2]]
    b = P[(idx + 1) % n][:, [0, 2]]
    ab = b - a
    ap = np.array([x, z]) - a
    denom = np.einsum("ij,ij->i", ab, ab)
    denom[denom == 0] = 1e-9
    t = np.clip(np.einsum("ij,ij->i", ap, ab) / denom, 0.0, 1.0)
    q = a + ab * t[:, None]
    d2 = np.einsum("ij,ij->i", q - np.array([x, z]), q - np.array([x, z]))
    k = int(np.argmin(d2))
    i = int(idx[k])
    seg_len = np.sqrt(denom[k])
    s = S[i] + t[k] * seg_len
    cross = ab[k][0] * ap[k][1] - ab[k][1] * ap[k][0]
    # x east, z south: a positive cross product here means the point lies to the right of travel.
    lateral = float(np.sqrt(d2[k])) * (1.0 if cross > 0 else -1.0)
    return float(s), lateral, i


def bounds(P, pad=0.0):
    lo = P.min(axis=0) - pad
    hi = P.max(axis=0) + pad
    return lo, hi


def grid_chunks(lo, hi, spacing, max_points=262144):
    """The same rectangular lattice in bounded row batches, including a 69 km route's extent."""
    gx = np.arange(lo[0], hi[0] + spacing, spacing)
    gz = np.arange(lo[1], hi[1] + spacing, spacing)
    rows = max(1, max_points // max(1, len(gz)))
    for start in range(0, len(gx), rows):
        yield np.stack(np.meshgrid(gx[start:start + rows], gz, indexing="ij"), axis=-1).reshape(-1, 2)
