package channel

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/coder/websocket"
)

// brokerScreenReadTimeout bounds one screen read: dial, replay frame, close.
const brokerScreenReadTimeout = 1500 * time.Millisecond

// ReadBrokerScreen returns the visible rows of a pty broker's session, rendered
// by this process's own screen emulator from the broker's scrollback replay.
// It never writes to the session: no input, no resize. Reading on the server
// rather than asking the broker to detect means a broker started by an older
// binary is read with current detection — detection that lived only in the
// broker left such sessions blind to prompts it did not know.
func ReadBrokerScreen(ctx context.Context, port int, token string) ([]string, error) {
	ctx, cancel := context.WithTimeout(ctx, brokerScreenReadTimeout)
	defer cancel()
	c, resp, err := websocket.Dial(ctx, fmt.Sprintf("ws://127.0.0.1:%d/ws", port), &websocket.DialOptions{
		HTTPHeader: http.Header{"Authorization": {"Bearer " + token}},
	})
	if resp != nil && resp.Body != nil {
		_ = resp.Body.Close()
	}
	if err != nil {
		return nil, fmt.Errorf("dial broker: %w", err)
	}
	defer func() { _ = c.Close(websocket.StatusNormalClosure, "") }()
	c.SetReadLimit(1 << 20)
	_, data, err := c.Read(ctx)
	if err != nil {
		// A broker with no scrollback sends no replay frame: an empty screen.
		if errors.Is(ctx.Err(), context.DeadlineExceeded) {
			return nil, nil
		}
		return nil, fmt.Errorf("read replay: %w", err)
	}
	return renderRows(data), nil
}
