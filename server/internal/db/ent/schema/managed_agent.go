package schema

import (
	"time"

	"entgo.io/ent"
	"entgo.io/ent/schema/field"
)

// ManagedAgent is the proof that the dashboard owns an agent's lifecycle
// (3N.2.1): written only after this server launched the Claude process itself,
// keyed by the session id it pinned (--session-id) or resumed (--resume), with
// the PID it launched. Ownership needs both to match a scanned agent, so a
// session later resumed from a terminal, or a reused PID, is not owned.
//
// It also records the one allowed-folder entry the dashboard added when it
// created a projectless workspace for this agent, so deleting the agent can
// remove exactly that entry — and nothing it did not add.
type ManagedAgent struct{ ent.Schema }

func (ManagedAgent) Fields() []ent.Field {
	return []ent.Field{
		// The Claude session id.
		field.String("id").StorageKey("session_id").Immutable().NotEmpty(),
		field.Int("pid").Positive(),
		field.String("cwd").Default(""),
		field.Bool("workspace_created").Default(false),
		field.String("allowed_folder").Default(""),
		field.Time("created_at").Default(time.Now).Immutable(),
		field.Time("updated_at").Default(time.Now).UpdateDefault(time.Now),
	}
}
