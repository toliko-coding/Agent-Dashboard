package identity

import (
	"crypto/sha256"
	"encoding/hex"
)

/*
Opaque identifiers for a repository and a workspace.

# Why not the canonical path

The canonical keys are filesystem paths, and one of them must never leave the
server: a repository's key is its `--git-common-dir`, i.e. a `.git` internal
path. Nothing in the UI can act on it, and publishing internal git layout —
including, for a submodule, `<super>/.git/modules/<name>` — states more about
the machine than any caller needs.

The workspace key is a working-tree root, which is very close to what `cwd`
already exposes on every agent. Hashing it is therefore not a secrecy win; it
is consistency, so that one kind of thing has one kind of identifier and a
caller never has to know which of the two it may compare, log or key a list on.

# What these are, honestly

A truncated SHA-256 of the canonical key. Deterministic and stable for the
lifetime of a path, unsalted so the same workspace yields the same id in every
process and across restarts, which is what makes them usable as list keys.

They are NOT secrets, and must not be treated as an access-control boundary.
The input is a filesystem path — a low-entropy value drawn from a small,
guessable space — so anyone holding a candidate path can confirm it by hashing
it. What the hash does buy is that the id is not a plain-text encoding: it
cannot be read, decoded or pattern-matched back into a path by a client that
did not already know the path.

The real protection is that the repository key is never serialised at all; see
the ref types in the merger, which carry an id and a display name and nothing
that reconstructs a path.

# Length

128 bits of a SHA-256, hex-encoded. Collision probability across even millions
of workspaces on one machine is negligible, and a shorter id stays readable in
a log line and a Vue `:key`.
*/

// idLen is the hex length of an opaque id: 32 chars = 128 bits.
const idLen = 32

// WorkspaceID returns the opaque identifier for a canonical workspace key.
//
// The prefix is a type tag, not decoration: a workspace id and a repository id
// are both 32 hex characters, and an untagged pair is impossible to tell apart
// in a log, a test failure or a payload — which is exactly the confusion this
// model exists to remove.
func WorkspaceID(canonicalRoot string) string {
	if canonicalRoot == "" {
		return ""
	}
	return "ws_" + digest("workspace", canonicalRoot)
}

// RepositoryID returns the opaque identifier for a canonical repository key
// (the --git-common-dir). Two workspaces share this id exactly when they share
// a repository, which is the relation the whole model turns on.
func RepositoryID(canonicalCommonDir string) string {
	if canonicalCommonDir == "" {
		return ""
	}
	return "repo_" + digest("repository", canonicalCommonDir)
}

// digest hashes a key under a domain label.
//
// The domain is mixed into the hash rather than only prefixed onto the result,
// so the digests differ even when the same path is asked about as both kinds.
// Prefix-only tagging would leave two ids whose bodies are byte-identical, and
// any comparison that stripped or truncated the tag — a log grep, a shortened
// display, a future migration — would silently equate a workspace with a
// repository. The separator cannot occur in a path, so no pair of (domain, key)
// inputs can be confused for another.
func digest(domain, key string) string {
	sum := sha256.Sum256([]byte(domain + "\x00" + key))
	return hex.EncodeToString(sum[:])[:idLen]
}
