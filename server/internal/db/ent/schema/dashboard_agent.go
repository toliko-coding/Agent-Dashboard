package schema

import (
	"time"

	"entgo.io/ent"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"
)

// DashboardAgent is an agent as a durable dashboard entity, as opposed to the
// Claude process that happens to be running it.
//
// A session is a runtime instance: it ends, and its pid is reused by the
// machine. What the user configured — what to call it, how it should work, what
// it may do without asking — belongs to the agent and has to outlive any of
// that. So this row is keyed by an id of its own and merely *points* at the
// session currently realising it.
//
// It is deliberately separate from agent_profile, which is keyed by session id
// and documented as presentation that never authorizes anything. Permission
// mode is not presentation, and the main-agent role must survive a session id
// changing, so neither could live there without contradicting that contract.
// Existing agent_profile rows keep working: the merger reads this row first and
// falls back to the profile, so nothing had to be migrated or deleted.
type DashboardAgent struct{ ent.Schema }

func (DashboardAgent) Fields() []ent.Field {
	return []ent.Field{
		// A stable id of this agent's own. The seeded main agent uses the fixed
		// id "main"; every other row gets a uuid.
		field.String("id").StorageKey("id").Immutable().NotEmpty(),
		// Presentation, same meaning as agent_profile's.
		field.String("display_name").Default(""),
		field.String("category").Default(""),
		// The agent's standing instructions, passed as claude's system prompt
		// when a session is started for it. Empty means none.
		field.Text("instructions").Default(""),
		// The permission mode saved for the NEXT session. It never describes a
		// running process: claude reads its mode once, at startup, so a session
		// already running keeps whatever it was given.
		field.String("permission_mode").Default(""),
		// The working folder this agent belongs to, and the project when it has
		// one. Association only — it grants no access to either.
		field.String("cwd").Default(""),
		field.String("project_id").Default(""),
		// "main" for the one agent that maintains Agent Dashboard itself, "" for
		// every other agent. A role is an identity, never an authority: nothing
		// on the server grants, bypasses or escalates anything because of it.
		field.String("role").Default(""),
		// The Claude session currently realising this agent, "" when none is.
		// A pointer, not the identity: the row outlives any session it names.
		field.String("session_id").Default(""),
		field.Time("created_at").Default(time.Now).Immutable(),
		field.Time("updated_at").Default(time.Now).UpdateDefault(time.Now),
	}
}

func (DashboardAgent) Indexes() []ent.Index {
	return []ent.Index{
		// Every roster tick looks agents up by the session they are running.
		index.Fields("session_id"),
		index.Fields("role"),
	}
}
