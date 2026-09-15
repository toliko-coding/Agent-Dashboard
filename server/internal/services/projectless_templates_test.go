package services

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestResumeEditorTemplate_ScaffoldsAndNeverOverwrites(t *testing.T) {
	tmpl, err := LookupProjectlessTemplate(TemplateResumeEditor)
	require.NoError(t, err)
	_, err = LookupProjectlessTemplate("../etc")
	require.ErrorIs(t, err, ErrUnknownTemplate)

	ws := t.TempDir()
	require.NoError(t, ApplyProjectlessTemplate(ws, tmpl))
	for _, dir := range []string{"master-cv", "job-descriptions", "tailored", "exports", "notes"} {
		info, serr := os.Stat(filepath.Join(ws, dir))
		require.NoError(t, serr)
		require.True(t, info.IsDir())
	}
	rules, err := os.ReadFile(filepath.Join(ws, "CLAUDE.md"))
	require.NoError(t, err)
	for _, rule := range []string{"only source of personal and professional claims", "Never invent", "Never overwrite, rename or delete anything in `master-cv/`", "Missing requirement"} {
		require.Contains(t, string(rules), rule)
	}

	require.Error(t, ApplyProjectlessTemplate(ws, tmpl), "a non-empty workspace is never scaffolded again")

	// Undo keeps what the person added or changed.
	cv := filepath.Join(ws, "master-cv", "cv.md")
	require.NoError(t, os.WriteFile(cv, []byte("# Synthetic CV"), 0o600))
	require.NoError(t, os.WriteFile(filepath.Join(ws, "README.md"), []byte("my notes"), 0o600))
	RemoveProjectlessTemplate(ws, tmpl)
	_, err = os.Stat(cv)
	require.NoError(t, err, "the person's CV survives")
	readme, _ := os.ReadFile(filepath.Join(ws, "README.md"))
	require.Equal(t, "my notes", string(readme), "a changed file is not removed")
	_, err = os.Stat(filepath.Join(ws, "CLAUDE.md"))
	require.True(t, os.IsNotExist(err), "an unchanged template file is removed")
	_, err = os.Stat(filepath.Join(ws, "notes"))
	require.True(t, os.IsNotExist(err), "an empty template folder is removed")
	require.False(t, strings.Contains(string(rules), "\t"))
}
