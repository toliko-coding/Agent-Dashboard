package schema

import (
	"time"

	"entgo.io/ent"
	"entgo.io/ent/schema/edge"
	"entgo.io/ent/schema/field"
)

// RoadmapItem is one piece of work inside a roadmap phase (Phase 4B).
//
// An item may link a pipeline task of the same project (task_id). A linked
// item's status is then read from the task, not from this row, and is
// reported as verified — the one way an item becomes verified.
type RoadmapItem struct{ ent.Schema }

// Fields of the RoadmapItem.
func (RoadmapItem) Fields() []ent.Field {
	return []ent.Field{
		field.String("id").StorageKey("id").Immutable(),
		field.String("title").MaxLen(200),
		field.String("status").Default("planned"),
		field.Int("position").Default(0),
		field.String("provenance").Default("user"),
		field.String("blocked_reason").Default("").MaxLen(500),
		field.String("task_id").Optional().Nillable(),
		field.Time("created_at").Default(time.Now).Immutable(),
		field.Time("updated_at").Default(time.Now).UpdateDefault(time.Now),
	}
}

// Edges of the RoadmapItem.
func (RoadmapItem) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("phase", RoadmapPhase.Type).Ref("items").Unique().Required(),
	}
}
