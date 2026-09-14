package services

import "github.com/lx-wnk/agent-dashboard/server/internal/db/ent"

// AdditionalDirsForProject returns the paths of project folders that should be
// passed to the `claude` CLI via --add-dir flags. It excludes:
//   - any folder whose path is empty
//   - any folder whose path equals cwd (already the working directory)
//   - duplicate paths (first occurrence wins)
//
// Order is preserved from the input slice (caller controls ordering; the repo
// returns default-first by convention).
func AdditionalDirsForProject(folders []*ent.ProjectFolder, cwd string) []string {
	if len(folders) == 0 {
		return nil
	}
	seen := make(map[string]struct{}, len(folders))
	var dirs []string
	for _, f := range folders {
		if f == nil || f.Path == "" {
			continue
		}
		if f.Path == cwd {
			continue
		}
		if _, dup := seen[f.Path]; dup {
			continue
		}
		seen[f.Path] = struct{}{}
		dirs = append(dirs, f.Path)
	}
	return dirs
}

// CwdWithinFolders reports whether cwd is one of folders or inside one of them.
//
// A Project is an organisational association. Its other folders reach an agent
// (as --add-dir) only when the agent works in one of that Project's own
// folders — never merely because a spawn request named the Project, which would
// let the association widen an agent's file access.
func CwdWithinFolders(folders []*ent.ProjectFolder, cwd string) bool {
	cwdAbs, err := canonicalize(cwd)
	if err != nil {
		return false
	}
	for _, f := range folders {
		if f == nil || f.Path == "" {
			continue
		}
		root, err := canonicalize(f.Path)
		if err != nil {
			continue
		}
		if isUnder(cwdAbs, root) {
			return true
		}
	}
	return false
}
