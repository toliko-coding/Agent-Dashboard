package services

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/lx-wnk/agent-dashboard/server/internal/settings"
)

type memProjectlessSettings struct{ values map[string]string }

func (m *memProjectlessSettings) String(key string) string { return m.values[key] }
func (m *memProjectlessSettings) Set(_ context.Context, key, value string) error {
	if def, ok := settings.Lookup(key); ok {
		if err := def.Validate(value); err != nil {
			return err
		}
	}
	m.values[key] = value
	return nil
}

func projectlessHome(t *testing.T) string {
	t.Helper()
	home, err := filepath.EvalSymlinks(t.TempDir())
	require.NoError(t, err)
	t.Setenv("HOME", home)
	return home
}

var safeFolder = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]*[A-Za-z0-9]$|^[A-Za-z0-9]$`)

func TestProjectlessFolderName(t *testing.T) {
	cases := map[string]string{
		"Resume Editor":         "Resume-Editor",
		"  WalletRadar  ":       "WalletRadar",
		"../../etc/passwd":      "etc-passwd",
		"/Users/me/secret":      "Users-me-secret",
		`C:\Windows\System32`:   "C-Windows-System32",
		".hidden":               "hidden",
		"a..b":                  "a.b",
		"Research: Q3 / 2026 ✓": "Research-Q3-2026",
	}
	for in, want := range cases {
		got, err := ProjectlessFolderName(in)
		require.NoError(t, err, in)
		require.Equal(t, want, got, in)
		require.Regexp(t, safeFolder, got, in)
	}

	for _, bad := range []string{"", "   ", "..", "../..", "/", "✓✓✓", "CON", "nul.txt", "lpt1"} {
		_, err := ProjectlessFolderName(bad)
		require.ErrorIs(t, err, ErrAgentFolderName, bad)
	}

	long, err := ProjectlessFolderName(strings.Repeat("Research ", 20))
	require.NoError(t, err)
	require.LessOrEqual(t, len(long), maxFolderName)
}

func TestEffectiveProjectlessRoot_DefaultThenConfigured(t *testing.T) {
	home := projectlessHome(t)
	s := &memProjectlessSettings{values: map[string]string{}}
	root, isDefault, err := EffectiveProjectlessRoot(s)
	require.NoError(t, err)
	require.True(t, isDefault)
	require.Equal(t, filepath.Join(home, "Documents", "AI-Agents"), root)

	custom := filepath.Join(home, "Agents")
	require.NoError(t, SetProjectlessRoot(context.Background(), s, custom))
	root, isDefault, err = EffectiveProjectlessRoot(s)
	require.NoError(t, err)
	require.False(t, isDefault)
	require.Equal(t, custom, root)
}

func TestValidateProjectlessRoot(t *testing.T) {
	home := projectlessHome(t)
	require.NoError(t, os.MkdirAll(filepath.Join(home, ".ssh"), 0o700))
	file := filepath.Join(home, "notes.txt")
	require.NoError(t, os.WriteFile(file, []byte("x"), 0o600))

	require.NoError(t, ValidateProjectlessRoot(filepath.Join(home, "AI-Agents")), "creatable in an existing folder")
	require.NoError(t, ValidateProjectlessRoot(filepath.Join(home, "Documents", "AI-Agents")), "intermediate folders are created on first use")
	for _, bad := range []string{"relative/agents", "/", home, file, filepath.Join(file, "child"), home + "/x/../y"} {
		require.Error(t, ValidateProjectlessRoot(bad), bad)
	}
	require.ErrorIs(t, ValidateProjectlessRoot(filepath.Join(home, ".ssh", "agents")), ErrCwdBlacklisted)
}

func TestCreateProjectlessWorkspace_CreatesAPlainFolderAndAllowsOnlyIt(t *testing.T) {
	home := projectlessHome(t)
	s := &memProjectlessSettings{values: map[string]string{WorkingFoldersSettingKey: "[]"}}

	ws, err := CreateProjectlessWorkspace(context.Background(), s, "Resume Editor")
	require.NoError(t, err)
	want := filepath.Join(home, "Documents", "AI-Agents", "Resume-Editor")
	require.Equal(t, want, ws.Path)
	require.Equal(t, "Resume-Editor", ws.Folder)

	info, err := os.Stat(want)
	require.NoError(t, err)
	require.True(t, info.IsDir())
	_, err = os.Stat(filepath.Join(want, ".git"))
	require.True(t, os.IsNotExist(err), "no Git repository is created")

	// Exactly the new folder is allowed; the root itself is not.
	require.Equal(t, []string{want}, WorkingFolders(s))
	policy := NewSpawnPolicy(WorkingFolderRootsProvider(s))
	require.NoError(t, policy.Allow(context.Background(), want))
	sibling := filepath.Join(home, "Documents", "AI-Agents", "Other")
	require.NoError(t, os.Mkdir(sibling, 0o755))
	require.ErrorIs(t, policy.Allow(context.Background(), sibling), ErrCwdNotAllowed, "the root does not allow every child")
}

func TestCreateProjectlessWorkspace_TraversalStaysInsideTheRoot(t *testing.T) {
	home := projectlessHome(t)
	s := &memProjectlessSettings{values: map[string]string{WorkingFoldersSettingKey: "[]"}}
	root := filepath.Join(home, "Documents", "AI-Agents")

	ws, err := CreateProjectlessWorkspace(context.Background(), s, "../../evil")
	require.NoError(t, err)
	require.Equal(t, root, filepath.Dir(ws.Path))
	_, err = os.Stat(filepath.Join(home, "evil"))
	require.True(t, os.IsNotExist(err))
}

func TestCreateProjectlessWorkspace_NeverReusesAnExistingFolder(t *testing.T) {
	home := projectlessHome(t)
	s := &memProjectlessSettings{values: map[string]string{WorkingFoldersSettingKey: "[]"}}
	existing := filepath.Join(home, "Documents", "AI-Agents", "Portfolio")
	require.NoError(t, os.MkdirAll(existing, 0o755))
	marker := filepath.Join(existing, "keep.txt")
	require.NoError(t, os.WriteFile(marker, []byte("mine"), 0o600))

	preview, err := PreviewProjectlessWorkspace(s, "Portfolio")
	require.NoError(t, err)
	require.True(t, preview.Exists)

	_, err = CreateProjectlessWorkspace(context.Background(), s, "Portfolio")
	require.ErrorIs(t, err, ErrWorkspaceExists)
	got, err := os.ReadFile(marker)
	require.NoError(t, err)
	require.Equal(t, "mine", string(got))
	require.Empty(t, WorkingFolders(s), "an existing folder is not silently allowed")
}

func TestCreateProjectlessWorkspace_RefusesASensitiveRoot(t *testing.T) {
	home := projectlessHome(t)
	require.NoError(t, os.MkdirAll(filepath.Join(home, ".aws"), 0o700))
	s := &memProjectlessSettings{values: map[string]string{WorkingFoldersSettingKey: "[]"}}

	// A symlinked root that lands in a sensitive directory is refused too.
	link := filepath.Join(home, "agents-link")
	require.NoError(t, os.Symlink(filepath.Join(home, ".aws"), link))
	s.values[ProjectlessRootKey] = link
	_, err := CreateProjectlessWorkspace(context.Background(), s, "Research")
	require.Error(t, err)
	require.True(t, errors.Is(err, ErrCwdBlacklisted) || errors.Is(err, ErrProjectlessRoot))
	_, statErr := os.Stat(filepath.Join(home, ".aws", "Research"))
	require.True(t, os.IsNotExist(statErr))
}

func TestChangingTheRootMovesNothing(t *testing.T) {
	home := projectlessHome(t)
	s := &memProjectlessSettings{values: map[string]string{WorkingFoldersSettingKey: "[]"}}
	first, err := CreateProjectlessWorkspace(context.Background(), s, "Research")
	require.NoError(t, err)

	require.NoError(t, SetProjectlessRoot(context.Background(), s, filepath.Join(home, "Elsewhere")))
	_, err = os.Stat(first.Path)
	require.NoError(t, err, "the existing workspace stays where it is")
	require.Contains(t, WorkingFolders(s), first.Path, "and stays allowed")
	_, err = os.Stat(filepath.Join(home, "Elsewhere"))
	require.True(t, os.IsNotExist(err), "a new root is only created when first used")
}
