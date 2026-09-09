package localscope

import (
	"net/http"
)

/*
 * Normalized devices.
 *
 * Same shape of answer as services and processes: the dashboard's own types,
 * the shared freshness state machine, and `items` that is null when the list is
 * not known rather than an empty list that would claim the machine has none.
 *
 * Devices need one thing the other lists do not, because LocalScope's own
 * collector says so: an empty device list is only a measurement when every
 * adapter actually ran. Its summary endpoint derives exactly this
 * (`devicesAvailable := every degradation is 'partial'`, otherwise the count is
 * reported as null), and the page used to read that derived count from the
 * summary — a different sample than the list beside it. Deriving it here from
 * the same payload as the items keeps the two coherent, and keeps LocalScope's
 * rule stated in one place on this side.
 */

// Device is one emulator, simulator or physical device.
//
// Only what LocalScope supplies. It also returns an adapter-specific `details`
// map (adb transport ids, simctl runtime identifiers); nothing renders it, and
// carrying an unread free-form map into this contract would be inventing a
// capability rather than reporting one.
type Device struct {
	ID     string `json:"id"`
	Serial string `json:"serial"`
	// Platform is android or ios; Form is emulator, simulator or physical.
	Platform string `json:"platform"`
	Form     string `json:"form"`
	// State is online, offline, unauthorized or unavailable, in the adapter's
	// own words.
	State string `json:"state"`
	// Model and OSVersion are null when the adapter could not read them — an
	// unauthorized device answers almost nothing about itself.
	Model     *string `json:"model"`
	OSVersion *string `json:"osVersion"`
}

// DevicesResponse is GET /api/localscope/devices.
type DevicesResponse struct {
	Freshness
	// Items is null when the list is not known, and [] when the adapters looked
	// and found none.
	Items []Device `json:"items"`
	// Connected is the device count, and only when it is a real measurement:
	// null when an adapter could not run at all, so "0 devices connected" is
	// never claimed for a machine that was never asked. An adapter reporting
	// partial results still counts as having run — that is LocalScope's rule,
	// and it is why 30 uninstalled simulator runtimes do not erase the two
	// devices that are genuinely there.
	Connected *int `json:"connected"`
}

type rawDevice struct {
	ID        string  `json:"id"`
	Serial    string  `json:"serial"`
	Platform  string  `json:"platform"`
	Form      string  `json:"form"`
	State     string  `json:"state"`
	Model     *string `json:"model"`
	OSVersion *string `json:"osVersion"`
}

func devicesFrom(raw []rawDevice) []Device {
	out := make([]Device, 0, len(raw))
	for _, d := range raw {
		out = append(out, Device{
			ID: d.ID, Serial: d.Serial, Platform: d.Platform,
			Form: d.Form, State: d.State, Model: d.Model, OSVersion: d.OSVersion,
		})
	}
	return out
}

// adaptersRan reports whether the device list can be read as a count.
//
// Every degradation being 'partial' means each adapter ran and qualified its
// answer; anything else (missing, unavailable, timeout, failed) means at least
// one adapter produced nothing, so the list is not a complete measurement.
func adaptersRan(degraded []Degradation) bool {
	for _, d := range degraded {
		if d.Kind != "partial" {
			return false
		}
	}
	return true
}

/*
 * devices handles GET /api/localscope/devices.
 *
 * Written out rather than through serveList because the count travels with the
 * list and has to be remembered with it — the same reason the processes handler
 * keeps its denominator in a second reading stored at the same timestamp.
 *
 * No query string is built, matching the other normalized reads: `all=true`
 * means nothing to the devices endpoint, and this route cannot reach it.
 */
func (h *Handler) devices(w http.ResponseWriter, r *http.Request) {
	body, err := h.fetchUpstream(r.Context(), "/api/system/devices")
	if err != nil {
		writeNormalized(w, h.staleDevices())
		return
	}

	raw, degraded, at, rawTime, decErr := decodeList[rawDevice](body)
	if decErr != nil {
		// A response that is not the contract is treated as no answer at all.
		// Decoding it partially is how a renamed field becomes "no devices".
		writeNormalized(w, h.staleDevices())
		return
	}

	items := devicesFrom(raw)
	var connected *int
	if adaptersRan(degraded) {
		count := len(items)
		connected = &count
	}

	h.lastDevices.store(items, degraded, at, rawTime)
	h.lastConnected.store(connected, degraded, at, rawTime)

	writeNormalized(w, DevicesResponse{
		Freshness: freshFrom(at, rawTime, degraded),
		Items:     items,
		Connected: connected,
	})
}

// staleDevices is the previous device list marked stale, or nothing known.
//
// The count comes from its own remembered reading rather than being recomputed
// from the retained items: a count is a claim about now, and re-deriving one
// from an old list would turn a remembered reading into a fresh assertion.
func (h *Handler) staleDevices() DevicesResponse {
	items, fresh, _ := h.lastDevices.staleOrUnknown()
	connected, _, haveCount := h.lastConnected.staleOrUnknown()
	resp := DevicesResponse{Freshness: fresh, Items: items}
	if haveCount {
		resp.Connected = connected
	}
	return resp
}
