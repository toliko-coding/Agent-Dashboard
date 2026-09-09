package localscope

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/require"
)

/*
 * Devices carry a distinction the other lists do not: zero devices connected
 * and no adapter having run are different facts, and LocalScope keeps them
 * apart. This endpoint has to keep them apart too, from one sample rather than
 * from two.
 */

func getDevices(t *testing.T, r *chi.Mux) DevicesResponse {
	t.Helper()
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/localscope/devices", nil))
	require.Equal(t, http.StatusOK, rec.Code)
	var out DevicesResponse
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &out), "body: %s", rec.Body.String())
	return out
}

const twoDevices = `[
	{"id":"android:emulator-5554","serial":"emulator-5554","platform":"android",
	 "form":"emulator","state":"online","model":"sdk gphone64 arm64","osVersion":"Android 13",
	 "details":{"transport_id":"10"}},
	{"id":"ios:CF0EAD69","serial":"CF0EAD69","platform":"ios","form":"simulator",
	 "state":"online","model":"iPhone 17","osVersion":"iOS 26.5",
	 "details":{"simctl_state":"Booted"}}
]`

const adbMissing = `[{"source":"adb","reason":"adb is not on PATH","kind":"missing"}]`

const simctlPartial = `[{"source":"simctl","reason":"30 simulators are unavailable across 3 runtimes that are not installed","kind":"partial"}]`

func TestDevices_HealthyNonEmpty(t *testing.T) {
	u := newUpstream(t)
	u.body = listBody(twoDevices, nowISO(), "")
	_, r := snapshotHandlerFor(t, u)

	got := getDevices(t, r)
	require.Equal(t, SourceOK, got.Source)
	require.Len(t, got.Items, 2)
	require.Equal(t, "/api/system/devices", u.lastPath)
	require.Empty(t, u.lastQury, "the normalized read builds no query string")

	android := got.Items[0]
	require.Equal(t, "android:emulator-5554", android.ID)
	require.Equal(t, "emulator-5554", android.Serial)
	require.Equal(t, "android", android.Platform)
	require.Equal(t, "emulator", android.Form)
	require.Equal(t, "online", android.State)
	require.NotNil(t, android.Model)
	require.Equal(t, "sdk gphone64 arm64", *android.Model)
	require.NotNil(t, android.OSVersion)

	// iOS is collected — simulators are real devices here, not a placeholder.
	require.Equal(t, "ios", got.Items[1].Platform)
	require.Equal(t, "simulator", got.Items[1].Form)

	require.NotNil(t, got.Connected)
	require.Equal(t, 2, *got.Connected)
}

// The whole point of the endpoint: an adapter that ran and found nothing.
func TestDevices_HealthyEmptyIsACollectedZero(t *testing.T) {
	u := newUpstream(t)
	u.body = listBody(`[]`, nowISO(), "")
	_, r := snapshotHandlerFor(t, u)

	got := getDevices(t, r)
	require.Equal(t, SourceOK, got.Source)
	require.NotNil(t, got.Items)
	require.Empty(t, got.Items)
	require.False(t, rawItemsNull(t, r, "/api/localscope/devices"),
		"a collected empty list must be [] on the wire, never null")
	require.NotNil(t, got.Connected, "an adapter ran, so zero is a measurement")
	require.Equal(t, 0, *got.Connected)
}

// …and its opposite: no adapter ran, so the empty list is not a zero.
func TestDevices_NoAdapterRanIsNotZeroConnected(t *testing.T) {
	u := newUpstream(t)
	u.body = listBody(`[]`, nowISO(), adbMissing)
	_, r := snapshotHandlerFor(t, u)

	got := getDevices(t, r)
	require.Equal(t, SourceDegraded, got.Source)
	require.NotNil(t, got.Items, "the collector did answer, so the list is known")
	require.Empty(t, got.Items)
	require.Nil(t, got.Connected,
		"adb missing means the machine was never asked; 0 would be a lie")
	require.Len(t, got.Degraded, 1)
	require.Equal(t, "adb", got.Degraded[0].Source)
	require.Equal(t, "missing", got.Degraded[0].Kind)
}

// A partial degradation still counts as having run — LocalScope's own rule.
func TestDevices_PartialDegradationStillCounts(t *testing.T) {
	u := newUpstream(t)
	u.body = listBody(twoDevices, nowISO(), simctlPartial)
	_, r := snapshotHandlerFor(t, u)

	got := getDevices(t, r)
	require.Equal(t, SourceDegraded, got.Source)
	require.Len(t, got.Items, 2, "uninstalled runtimes must not erase real devices")
	require.NotNil(t, got.Connected)
	require.Equal(t, 2, *got.Connected)
	require.Equal(t, "simctl", got.Degraded[0].Source)
}

// One adapter down, the other working: what came back is still real.
func TestDevices_OneAdapterDownKeepsTheOther(t *testing.T) {
	u := newUpstream(t)
	u.body = listBody(`[{"id":"ios:X","serial":"X","platform":"ios","form":"simulator","state":"online","model":null,"osVersion":null}]`,
		nowISO(), adbMissing)
	_, r := snapshotHandlerFor(t, u)

	got := getDevices(t, r)
	require.Len(t, got.Items, 1)
	require.Nil(t, got.Items[0].Model, "a field the adapter could not read stays null")
	require.Nil(t, got.Connected, "the total is not trustworthy while an adapter is missing")
}

func TestDevices_UnreachableWithNoHistory(t *testing.T) {
	_, r := snapshotDeadHandler(t)

	got := getDevices(t, r)
	require.Equal(t, SourceUnavailable, got.Source)
	require.Nil(t, got.Items, "unknown is not empty")
	require.True(t, rawItemsNull(t, r, "/api/localscope/devices"))
	require.Nil(t, got.Connected)
	require.Nil(t, got.CollectedAt)
	require.NotNil(t, got.Degraded, "degraded is never null on the wire")
}

func TestDevices_StaleRetainsListAndCount(t *testing.T) {
	u := newUpstream(t)
	u.body = listBody(twoDevices, nowISO(), "")
	_, r := snapshotHandlerFor(t, u)

	require.Len(t, getDevices(t, r).Items, 2)

	// The collector goes away.
	u.srv.Close()

	got := getDevices(t, r)
	require.Equal(t, SourceStale, got.Source)
	require.Len(t, got.Items, 2, "the last known devices stay visible")
	require.NotNil(t, got.Connected)
	require.Equal(t, 2, *got.Connected)
	require.NotNil(t, got.CollectedAt)
	require.NotNil(t, got.AgeMs)
}

// A malformed payload must not decode into an empty machine.
func TestDevices_MalformedFailsSafe(t *testing.T) {
	for name, body := range map[string]string{
		"not json":          `{`,
		"data is null":      listBody(`null`, nowISO(), ""),
		"data is an object": listBody(`{"devices":[]}`, nowISO(), ""),
		"bad timestamp":     listBody(twoDevices, "not-a-time", ""),
		"wrong field type":  listBody(`[{"id":"x","serial":"y","platform":"android","form":"emulator","state":"online","model":42}]`, nowISO(), ""),
	} {
		t.Run(name, func(t *testing.T) {
			u := newUpstream(t)
			u.body = body
			_, r := snapshotHandlerFor(t, u)

			got := getDevices(t, r)
			require.Equal(t, SourceUnavailable, got.Source)
			require.Nil(t, got.Items, "an unreadable answer is not an empty list")
			require.Nil(t, got.Connected)
		})
	}
}

// A collector-side error is not a device count either.
func TestDevices_UpstreamErrorStatus(t *testing.T) {
	u := newUpstream(t)
	u.status = http.StatusInternalServerError
	u.body = `{"error":"boom"}`
	_, r := snapshotHandlerFor(t, u)

	got := getDevices(t, r)
	require.Equal(t, SourceUnavailable, got.Source)
	require.Nil(t, got.Items)
	require.Nil(t, got.Connected)
}
