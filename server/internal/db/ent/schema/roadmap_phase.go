package schema

import (
	"time"

	"entgo.io/ent"
	"entgo.io/ent/dialect/entsql"
	"entgo.io/ent/schema/edge"
	"entgo.io/ent/schema/field"
)

// RoadmapPhase is one phase or milestone of a Dashboard Project's roadmap
// (Phase 4B). Ordered by position within its project.
//
// status is one of planned, ready, active, blocked, completed, skipped (see
// internal/roadmap). is_current marks the one phase the project is at ("you are
// here"); the service keeps at most one per project. provenance is who stated
// the phase: "user" (entered or edited by a person) or "suggested" (accepted
// from an agent proposal and not yet edited). The server assigns it; a request
// can never set it.
type RoadmapPhase struct{ ent.Schema }

// Fields of the RoadmapPhase.
func (RoadmapPhase) Fields() []ent.Field {
	return []ent.Field{
		field.String("id").StorageKey("id").Immutable(),
		field.String("title").MaxLen(120),
		field.String("description").Default("").MaxLen(2000),
		field.String("status").Default("planned"),
		field.Int("position").Default(0),
		field.Bool("is_current").Default(false),
		field.String("provenance").Default("user"),
		field.String("blocked_reason").Default("").MaxLen(500),
		field.String("decisions").Default("").MaxLen(4000),
		field.JSON("depends_on", []string{}).Optional(),
		field.Time("created_at").Default(time.Now).Immutable(),
		field.Time("updated_at").Default(time.Now).UpdateDefault(time.Now),
	}
}

// Edges of the RoadmapPhase.
func (RoadmapPhase) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("project", Project.Type).Ref("roadmap_phases").Unique().Required(),
		edge.To("items", RoadmapItem.Type).Annotations(entsql.Annotation{OnDelete: entsql.Cascade}),
	}
}
