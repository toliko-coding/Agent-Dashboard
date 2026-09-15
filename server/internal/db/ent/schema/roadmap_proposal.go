package schema

import (
	"time"

	"entgo.io/ent"
	"entgo.io/ent/schema/edge"
	"entgo.io/ent/schema/field"
)

// RoadmapProposal is a roadmap an agent proposed for a project (Phase 4B),
// kept for a person to accept or reject. It never changes the roadmap by
// itself: accepting applies it as "suggested" phases.
//
// status is pending, accepted or rejected. payload is the validated proposal
// (objective, summary, phases with items and evidence) as it was received —
// an immutable snapshot, which is why it is JSON rather than rows.
type RoadmapProposal struct{ ent.Schema }

// Fields of the RoadmapProposal.
func (RoadmapProposal) Fields() []ent.Field {
	return []ent.Field{
		field.String("id").StorageKey("id").Immutable(),
		field.String("status").Default("pending"),
		field.String("source").Default("agent"),
		field.String("agent_session_id").Optional().Nillable(),
		field.String("summary").Default("").MaxLen(2000),
		field.JSON("payload", map[string]any{}),
		field.Time("created_at").Default(time.Now).Immutable(),
		field.Time("decided_at").Optional().Nillable(),
	}
}

// Edges of the RoadmapProposal.
func (RoadmapProposal) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("project", Project.Type).Ref("roadmap_proposals").Unique().Required(),
	}
}
