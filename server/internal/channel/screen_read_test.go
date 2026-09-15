package channel

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/coder/websocket"
)

// The server reads a broker's screen from its replay and never writes to it.
func TestReadBrokerScreen_RendersReplayWithoutWriting(t *testing.T) {
	var received atomic.Int32
	var auth atomic.Value
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		auth.Store(r.Header.Get("Authorization"))
		c, err := websocket.Accept(w, r, nil)
		if err != nil {
			return
		}
		defer c.Close(websocket.StatusNormalClosure, "")
		_ = c.Write(r.Context(), websocket.MessageBinary, []byte("Bash command\r\nDo you want to proceed?\r\n❯ 1. Yes\r\n  2. No\r\n"))
		for {
			if _, _, err := c.Read(r.Context()); err != nil {
				return
			}
			received.Add(1)
		}
	}))
	defer srv.Close()
	port, _ := strconv.Atoi(srv.URL[strings.LastIndex(srv.URL, ":")+1:])

	rows, err := ReadBrokerScreen(context.Background(), port, "tok")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(strings.Join(rows, "\n"), "Do you want to proceed?") {
		t.Fatalf("rows = %q", rows)
	}
	if auth.Load() != "Bearer tok" {
		t.Fatalf("authorization = %v", auth.Load())
	}
	time.Sleep(100 * time.Millisecond)
	if received.Load() != 0 {
		t.Fatalf("the screen read sent %d frames to the session", received.Load())
	}
}

func TestReadBrokerScreen_EmptyScrollback(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		c, err := websocket.Accept(w, r, nil)
		if err != nil {
			return
		}
		defer c.Close(websocket.StatusNormalClosure, "")
		<-r.Context().Done()
	}))
	defer srv.Close()
	port, _ := strconv.Atoi(srv.URL[strings.LastIndex(srv.URL, ":")+1:])
	rows, err := ReadBrokerScreen(context.Background(), port, "tok")
	if err != nil || len(rows) != 0 {
		t.Fatalf("an empty broker is an empty screen, got rows=%q err=%v", rows, err)
	}
}
