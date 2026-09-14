package settings

import "testing"

func TestSpawnWorkingFoldersValidation(t *testing.T) {
	def, ok := Lookup(SpawnWorkingFoldersKey)
	if !ok {
		t.Fatal("spawn.workingFolders is not registered")
	}
	if def.Default != "[]" || def.Apply != ApplyLive {
		t.Fatalf("unexpected definition %+v", def)
	}
	for _, ok := range []string{`[]`, `["/Users/dev/code"]`, `["/a", "/b,with,commas"]`} {
		if err := def.Validate(ok); err != nil {
			t.Errorf("%s rejected: %v", ok, err)
		}
	}
	for _, bad := range []string{``, `/a`, `["relative/path"]`, `["/a/../b"]`, `["/a/"]`, `{"a":1}`} {
		if err := def.Validate(bad); err == nil {
			t.Errorf("%q accepted", bad)
		}
	}
}
