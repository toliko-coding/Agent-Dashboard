package schema

import (
	"time"

	"entgo.io/ent"
	"entgo.io/ent/schema/field"
)

// AgentProfile is presentation metadata the user gave an agent when starting
// it from the dashboard: an optional display name and an optional icon
// category. It is keyed by the Claude session id the dashboard pinned for that
// agent (--session-id) or resumed (--resume), which is the identity the agent
// stream already carries, so a profile survives reloads, restarts and rescans
// without any process or folder correlation.
//
// Presentation only: nothing here grants, scopes or authorizes anything, and
// it is not a Project, Repository or Workspace.
type AgentProfile struct{ ent.Schema }

func (AgentProfile) Fields() []ent.Field {
	return []ent.Field{
		// The Claude session id.
		field.String("id").StorageKey("session_id").Immutable().NotEmpty(),
		field.String("display_name").Default(""),
		field.String("category").Default(""),
		field.Time("created_at").Default(time.Now).Immutable(),
		field.Time("updated_at").Default(time.Now).UpdateDefault(time.Now),
	}
}
