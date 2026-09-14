package services

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/lx-wnk/agent-dashboard/server/internal/db/ent"
	"github.com/lx-wnk/agent-dashboard/server/internal/settings"
)

type memWorkingFolders struct{ values map[string]string }

func (m *memWorkingFolders) String(key string) string {
	if v, ok := m.values[key]; ok {
		return v
	}
	return "[]"
}

func (m *memWorkingFolders) Set(_ context.Context, key, value string) error {
	if def, ok := settings.Lookup(key); ok {
		if err := def.Validate(value); err != nil {
			return err
		}
	}
	m.values[key] = value
	return nil
}

func tempHome(t *testing.T) string {
	t.Helper()
	home, _ := filepath.EvalSymlinks(t.TempDir())
	t.Setenv("HOME", home)
	return home
}

func TestWorkingFolders_AddIsCanonicalAndOnce(t *testing.T) {
	home := tempHome(t)
	dir := filepath.Join(home, "code", "plain")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	s := &memWorkingFolders{values: map[string]string{}}
	if _, err := AddWorkingFolder(context.Background(), s, dir+"/"); err != nil {
		t.Fatal(err)
	}
	got, err := AddWorkingFolder(context.Background(), s, dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 || got[0] != dir {
		t.Fatalf("got %v, want [%s]", got, dir)
	}
	got, err = RemoveWorkingFolder(context.Background(), s, dir)
	if err != nil || len(got) != 0 || s.values[WorkingFoldersSettingKey] != "[]" {
		t.Fatalf("remove: %v %v %q", got, err, s.values[WorkingFoldersSettingKey])
	}
}

func TestWorkingFolders_RefusesSensitiveDirectory(t *testing.T) {
	home := tempHome(t)
	ssh := filepath.Join(home, ".ssh")
	if err := os.MkdirAll(ssh, 0o700); err != nil {
		t.Fatal(err)
	}
	s := &memWorkingFolders{values: map[string]string{}}
	if _, err := AddWorkingFolder(context.Background(), s, ssh); !errors.Is(err, ErrCwdBlacklisted) {
		t.Fatalf("err = %v, want ErrCwdBlacklisted", err)
	}
	if len(WorkingFolders(s)) != 0 {
		t.Fatal("a sensitive folder was stored")
	}
}

func TestWorkingFolders_UndecodableValueAllowsNothing(t *testing.T) {
	s := &memWorkingFolders{values: map[string]string{WorkingFoldersSettingKey: "not json"}}
	if got := WorkingFolders(s); got != nil {
		t.Fatalf("got %v", got)
	}
}

// The allow-list is the same control: a working folder admits its tree, and
// a folder in neither list is still refused while the list is non-empty.
func TestSpawnPolicy_WorkingFoldersJoinProjectRoots(t *testing.T) {
	home := tempHome(t)
	project := filepath.Join(home, "proj")
	plain := filepath.Join(home, "plain")
	other := filepath.Join(home, "other")
	for _, d := range []string{project, filepath.Join(plain, "sub"), other} {
		if err := os.MkdirAll(d, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	s := &memWorkingFolders{values: map[string]string{}}
	if _, err := AddWorkingFolder(context.Background(), s, plain); err != nil {
		t.Fatal(err)
	}
	projectRoots := func(context.Context) ([]string, error) { return []string{project}, nil }
	policy := NewSpawnPolicy(CombineRootsProviders(projectRoots, WorkingFolderRootsProvider(s)))
	ctx := context.Background()
	for _, ok := range []string{project, plain, filepath.Join(plain, "sub")} {
		if err := policy.Allow(ctx, ok); err != nil {
			t.Errorf("%s refused: %v", ok, err)
		}
	}
	if err := policy.Allow(ctx, other); !errors.Is(err, ErrCwdNotAllowed) {
		t.Errorf("%s: err = %v, want ErrCwdNotAllowed", other, err)
	}
}

func TestCombineRootsProviders_FailsClosed(t *testing.T) {
	boom := errors.New("db down")
	combined := CombineRootsProviders(
		func(context.Context) ([]string, error) { return []string{"/a"}, nil },
		func(context.Context) ([]string, error) { return nil, boom },
	)
	if _, err := combined(context.Background()); !errors.Is(err, boom) {
		t.Fatalf("err = %v", err)
	}
	policy := NewSpawnPolicy(combined)
	if err := policy.Allow(context.Background(), t.TempDir()); !errors.Is(err, ErrCwdNotAllowed) {
		t.Fatalf("a failing provider must refuse, got %v", err)
	}
}

func TestCwdWithinFolders(t *testing.T) {
	home := tempHome(t)
	web := filepath.Join(home, "app", "web")
	api := filepath.Join(home, "app", "api")
	elsewhere := filepath.Join(home, "elsewhere")
	for _, d := range []string{filepath.Join(web, "src"), api, elsewhere} {
		if err := os.MkdirAll(d, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	folders := []*ent.ProjectFolder{{Path: web}, {Path: api}}
	if !CwdWithinFolders(folders, web) || !CwdWithinFolders(folders, filepath.Join(web, "src")) {
		t.Error("a project folder and its subfolder are within")
	}
	if CwdWithinFolders(folders, elsewhere) {
		t.Error("an unrelated folder is not within the project")
	}
	if CwdWithinFolders(nil, web) {
		t.Error("no folders means not within")
	}
}
