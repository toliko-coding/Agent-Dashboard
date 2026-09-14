package services

import (
	"context"
	"encoding/json"
	"fmt"
	"slices"
	"sync"

	"github.com/lx-wnk/agent-dashboard/server/internal/settings"
)

/*
 * Working folders: the folders a user explicitly allowed agents to be started
 * in, apart from any Dashboard Project.
 *
 * The spawn policy's allow-list (F-SEC-001) used to be fed only by Project
 * folders, which made a Project the price of starting an agent anywhere. A
 * Project is an organisational grouping; it should not be what authorises a
 * working directory. The allow-list is unchanged as a control — a new spawn is
 * still refused outside it once it is non-empty — but it is now fed by two
 * explicit, user-made lists: Project folders and working folders.
 *
 * Adding a working folder is an explicit act with the same trust as adding a
 * Project folder (both require an authenticated user), is validated here, and
 * never touches Claude Code's own trust: Claude still asks whether to trust
 * the folder when an agent first starts there.
 */

// WorkingFolderSettings is the part of the settings service the allow-list
// needs: the stored value, and a validated write.
type WorkingFolderSettings interface {
	String(key string) string
	Set(ctx context.Context, key, value string) error
}

// WorkingFoldersSettingKey is the setting holding the list (see its definition).
const WorkingFoldersSettingKey = settings.SpawnWorkingFoldersKey

var workingFoldersMu sync.Mutex

// WorkingFolders returns the stored list. A value that does not decode reads
// as no working folders: the setting's own validator refuses such a write, so
// this only guards against a hand-edited row, and refusing its paths is the
// closed direction.
func WorkingFolders(s WorkingFolderSettings) []string {
	if s == nil {
		return nil
	}
	var paths []string
	if err := json.Unmarshal([]byte(s.String(WorkingFoldersSettingKey)), &paths); err != nil {
		return nil
	}
	return paths
}

// WorkingFolderRootsProvider exposes the working folders as spawn-policy roots.
func WorkingFolderRootsProvider(s WorkingFolderSettings) RootsProvider {
	return func(context.Context) ([]string, error) {
		return WorkingFolders(s), nil
	}
}

// CombineRootsProviders unions several root providers. Any provider's error is
// returned, so the policy fails closed exactly as it does for one provider.
func CombineRootsProviders(providers ...RootsProvider) RootsProvider {
	return func(ctx context.Context) ([]string, error) {
		var all []string
		for _, p := range providers {
			if p == nil {
				continue
			}
			roots, err := p(ctx)
			if err != nil {
				return nil, err
			}
			all = append(all, roots...)
		}
		return all, nil
	}
}

// AddWorkingFolder canonicalises path, refuses a sensitive directory, and
// appends it to the list once. The caller has already checked that the path is
// absolute and an existing directory.
func AddWorkingFolder(ctx context.Context, s WorkingFolderSettings, path string) ([]string, error) {
	canonical, err := canonicalize(path)
	if err != nil {
		return nil, err
	}
	if err := checkBlacklist(canonical); err != nil {
		return nil, err
	}
	workingFoldersMu.Lock()
	defer workingFoldersMu.Unlock()
	paths := WorkingFolders(s)
	if !slices.Contains(paths, canonical) {
		paths = append(paths, canonical)
	}
	return paths, writeWorkingFolders(ctx, s, paths)
}

// RemoveWorkingFolder removes path (as stored, or as it canonicalises) from the list.
func RemoveWorkingFolder(ctx context.Context, s WorkingFolderSettings, path string) ([]string, error) {
	canonical, err := canonicalize(path)
	if err != nil {
		canonical = path
	}
	workingFoldersMu.Lock()
	defer workingFoldersMu.Unlock()
	paths := slices.DeleteFunc(WorkingFolders(s), func(p string) bool { return p == path || p == canonical })
	return paths, writeWorkingFolders(ctx, s, paths)
}

func writeWorkingFolders(ctx context.Context, s WorkingFolderSettings, paths []string) error {
	if paths == nil {
		paths = []string{}
	}
	raw, err := json.Marshal(paths)
	if err != nil {
		return fmt.Errorf("working folders: encode: %w", err)
	}
	return s.Set(ctx, WorkingFoldersSettingKey, string(raw))
}
