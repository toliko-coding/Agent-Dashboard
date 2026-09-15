package services

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"slices"
)

/*
 * Projectless workspace templates (Phase 4C): a small, fixed scaffold the
 * server writes into a projectless workspace it has just created, for a
 * specialist agent.
 *
 * A template is applied only to a folder CreateProjectlessWorkspace created in
 * the same request — never to an existing folder — and only ever creates the
 * listed folders and files, all inside that workspace. A template's CLAUDE.md
 * carries the specialist's durable instructions: Claude Code loads it from the
 * working folder on every start and resume, so the role survives restarts and
 * "Resume under Dashboard" without depending on a system prompt.
 */

// ProjectlessTemplate is a scaffold for a specialist workspace.
type ProjectlessTemplate struct {
	ID    string
	Dirs  []string
	Files map[string]string
}

// ErrUnknownTemplate is returned for a template id that does not exist.
var ErrUnknownTemplate = errors.New("unknown workspace template")

// TemplateResumeEditor is the Resume Editor specialist's workspace.
const TemplateResumeEditor = "resume-editor"

var projectlessTemplates = map[string]ProjectlessTemplate{
	TemplateResumeEditor: {
		ID:    TemplateResumeEditor,
		Dirs:  []string{"master-cv", "job-descriptions", "tailored", "exports", "notes"},
		Files: map[string]string{"CLAUDE.md": resumeEditorInstructions, "README.md": resumeEditorReadme},
	},
}

// LookupProjectlessTemplate returns a template by id.
func LookupProjectlessTemplate(id string) (ProjectlessTemplate, error) {
	t, ok := projectlessTemplates[id]
	if !ok {
		return ProjectlessTemplate{}, ErrUnknownTemplate
	}
	return t, nil
}

func (t ProjectlessTemplate) fileNames() []string {
	names := make([]string, 0, len(t.Files))
	for name := range t.Files {
		names = append(names, name)
	}
	slices.Sort(names)
	return names
}

// ApplyProjectlessTemplate writes the template into workspace, which must be an
// empty folder the caller has just created. Existing files are never
// overwritten: creation uses O_EXCL, so any collision is an error.
func ApplyProjectlessTemplate(workspace string, t ProjectlessTemplate) error {
	entries, err := os.ReadDir(workspace)
	if err != nil {
		return fmt.Errorf("apply template: %w", err)
	}
	if len(entries) > 0 {
		return errors.New("apply template: the workspace is not empty")
	}
	for _, dir := range t.Dirs {
		if err := os.Mkdir(filepath.Join(workspace, dir), 0o755); err != nil {
			return fmt.Errorf("apply template: %w", err)
		}
	}
	for _, name := range t.fileNames() {
		f, err := os.OpenFile(filepath.Join(workspace, name), os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o644)
		if err != nil {
			return fmt.Errorf("apply template: %w", err)
		}
		_, werr := f.WriteString(t.Files[name])
		cerr := f.Close()
		if werr != nil || cerr != nil {
			return fmt.Errorf("apply template: write %s", name)
		}
	}
	return nil
}

// RemoveProjectlessTemplate undoes ApplyProjectlessTemplate after a failed
// spawn: it removes only the template's own files when unchanged and its
// folders when empty, so anything else in the workspace stays.
func RemoveProjectlessTemplate(workspace string, t ProjectlessTemplate) {
	for _, name := range t.fileNames() {
		path := filepath.Join(workspace, name)
		if data, err := os.ReadFile(path); err == nil && string(data) == t.Files[name] {
			_ = os.Remove(path)
		}
	}
	for _, dir := range t.Dirs {
		_ = os.Remove(filepath.Join(workspace, dir)) // only succeeds when empty
	}
}

const resumeEditorReadme = `# Resume Editor

A workspace for tailoring your CV to specific jobs with the Resume Editor agent in Agent Dashboard.

| Folder | What goes there |
|---|---|
| ` + "`master-cv/`" + ` | Your master CV — the source of truth. The agent reads it and never overwrites it. |
| ` + "`job-descriptions/`" + ` | Job descriptions you want to apply for, one file each (or paste them in chat). |
| ` + "`tailored/`" + ` | Job-specific versions, in ` + "`tailored/<company-or-role>/`" + `. |
| ` + "`exports/`" + ` | Final files you send (PDF, DOCX) when you ask for them. |
| ` + "`notes/`" + ` | Match analyses, decisions and anything else worth keeping. |

How to use it:

1. Put your master CV in ` + "`master-cv/`" + ` (Markdown or plain text works best).
2. Add or paste a job description.
3. Ask for a match analysis, review the recommended changes, then ask for the tailored version.

The agent's working rules are in ` + "`CLAUDE.md`" + `. Deleting the agent from Agent Dashboard never deletes these files.
`

const resumeEditorInstructions = `# Resume Editor — working rules

You are a professional CV / resume editor working in this folder for one person. You help them tailor their CV to specific jobs, truthfully.

## Sources of truth

- **The master CV in ` + "`master-cv/`" + ` is the only source of personal and professional claims**: employers, roles, dates, degrees, certifications, skills, achievements and numbers.
- **The job description is the target**: it says what the employer is looking for. It is never evidence about the person.
- If a fact is not in the master CV or stated by the person in this conversation, it is not true for this CV.

## Never

- Never invent or imply experience, employers, titles, dates, degrees, certifications, skills, tools, metrics or achievements.
- Never overwrite, rename or delete anything in ` + "`master-cv/`" + `. Edit only copies.
- Never silently drop important experience from a tailored version; if you remove or shorten something material, say so and why.
- Never change dates, employers or degrees unless the person explicitly asks.
- Never overwrite an existing tailored file: if the target name exists, create a new version (` + "`-v2`" + `, ` + "`-v3`" + `, …) or ask.

## For every job, distinguish three things

1. **Existing evidence** — something in the master CV that meets a requirement (quote or point to it).
2. **Wording improvement** — the same true fact, phrased to match the job's language, more concise or more concrete.
3. **Missing requirement** — something the job asks for that the master CV does not show. Say plainly that it is missing. Do not fill the gap; you may suggest the person add it only if it is actually true.

## Workflow

1. Read the master CV and the job description.
2. Give a **match analysis** before changing anything:
   - Match summary (a sentence or two, no invented score)
   - Strong matches (with the evidence)
   - Weak or missing requirements
   - Recommended changes (each marked as wording improvement, reordering, emphasis or removal)
3. Wait for the person to approve or adjust.
4. Write the tailored CV to ` + "`tailored/<company-or-role>/`" + `, keeping the master CV untouched, and a short ` + "`CHANGES.md`" + ` next to it explaining what changed and why.
5. Put the analysis in ` + "`notes/`" + ` if it is worth keeping. Produce exports only when asked.

## Style

Concise, professional, active voice, concrete results the CV already supports. Match the job's terminology only where it truthfully describes the person's experience. Keep the person's language and spelling conventions unless asked otherwise.

## Privacy

The CV and job descriptions are private. Do not copy their contents into files outside this folder, and do not include them in anything other than the files the person asks for.
`
