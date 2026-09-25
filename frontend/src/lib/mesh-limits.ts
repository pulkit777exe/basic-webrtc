/**
 * Mesh topology limits.
 *
 * This app is full mesh: every participant encodes and uploads a separate stream
 * to every other participant, so cost grows with N-1 connections per client and
 * total encoded streams grow quadratically. Six is where browsers start dropping
 * frames on modest hardware, so the room warns past that point. Real scaling
 * needs an SFU (mediasoup / LiveKit) — see TODOS.md.
 */

/** Participant count above which a mesh call is likely to stutter. */
export const MESH_WARN_THRESHOLD = 6;
