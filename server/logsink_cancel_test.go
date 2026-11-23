package server

import (
	"context"
	"errors"
	"net"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/Autumn-27/artex/db"
	"github.com/Autumn-27/artex/internal/dbtest"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/stdlib"
)

// pgx returns canceled queries before its asynchronous CancelRequest/connection
// cleanup finishes. Hold that separate cancellation connection until the table
// lock is released, so a server-side INSERT can finish after StopDB returns.
// This exercises the real PostgreSQL statement, not a mocked database result.
func TestStopDBDoesNotPersistCanceledInsert(t *testing.T) {
	testStopDBDoesNotPersistCanceledInsert(t, false)
}

// A failed initial address must not gate an ordinary fallback connection while
// establishing the writer or warming its prepared INSERT.
func TestStopDBDoesNotPersistCanceledInsertAfterConnectionFallback(t *testing.T) {
	testStopDBDoesNotPersistCanceledInsert(t, true)
}

func testStopDBDoesNotPersistCanceledInsert(t *testing.T, failFirstDial bool) {
	t.Helper()
	dsn := dbtest.DSN(t)
	watch, err := db.Open(dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer watch.Close()
	config, err := pgx.ParseConfig(dsn)
	if err != nil {
		t.Fatal(err)
	}
	var holdCancel, failConnection atomic.Bool
	failConnection.Store(failFirstDial)
	if failFirstDial {
		config.Fallbacks = append([]*pgconn.FallbackConfig{{
			Host: config.Host, Port: config.Port, TLSConfig: config.TLSConfig,
		}}, config.Fallbacks...)
	}
	cancelDial := make(chan struct{}, 1)
	releaseCancel := make(chan struct{})
	var releaseOnce sync.Once
	release := func() { releaseOnce.Do(func() { close(releaseCancel) }) }
	defer release()
	config.DialFunc = func(ctx context.Context, network, address string) (net.Conn, error) {
		if failConnection.Swap(false) {
			return nil, errors.New("synthetic first address unavailable")
		}
		if holdCancel.Load() {
			select {
			case cancelDial <- struct{}{}:
			default:
			}
			select {
			case <-releaseCancel:
			case <-ctx.Done():
				return nil, ctx.Err()
			}
		}
		return (&net.Dialer{}).DialContext(ctx, network, address)
	}
	pg := &db.DB{DB: stdlib.OpenDB(*config)}
	pg.SetMaxOpenConns(1)
	defer pg.Close()
	var writerPID int
	connectCtx, cancelConnect := context.WithTimeout(t.Context(), 5*time.Second)
	defer cancelConnect()
	if err := pg.QueryRowContext(connectCtx, "SELECT pg_backend_pid()").Scan(&writerPID); err != nil {
		t.Fatal(err)
	}
	s := newTestSink()
	s.SetDB(t.Context(), pg)
	defer s.StopDB(pg)
	marker := t.Name() + "-" + time.Now().Format("150405.000000000")
	// Warm pgx's prepared statement on this exact connection, so the blocked
	// operation is execution of INSERT rather than its initial Parse/Describe.
	s.add(LogLine{Level: "info", Text: marker + "-initial"})
	waitFor(t, "owned initial INSERT persisted", func() bool {
		return serverLogsMarkerCount(t, watch, marker+"-initial") == 1
	})
	tx, err := watch.BeginTx(t.Context(), nil)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback() // release the lock even if the regression fails
	if _, err := tx.Exec("LOCK TABLE server_logs IN ACCESS EXCLUSIVE MODE"); err != nil {
		t.Fatal(err)
	}
	s.add(LogLine{Level: "info", Text: marker})
	waitFor(t, "owned INSERT blocked on the held lock", func() bool {
		var blocked bool
		return watch.QueryRow(`SELECT EXISTS (SELECT 1 FROM pg_stat_activity
			WHERE datname=current_database() AND pid=$1 AND wait_event_type='Lock'
			AND query LIKE 'INSERT INTO server_logs%')`, writerPID).Scan(&blocked) == nil && blocked
	})
	// Only subsequent cancellation dials are held. Connection establishment,
	// including address fallback, has already completed on this exact backend.
	holdCancel.Store(true)
	stopped := make(chan struct{})
	go func() { s.StopDB(pg); close(stopped) }()
	select {
	case <-stopped:
	case <-time.After(5 * time.Second):
		t.Fatal("StopDB did not complete while its INSERT and cancellation connection were blocked")
	}
	select {
	case <-cancelDial:
	case <-time.After(5 * time.Second):
		t.Fatal("pgx did not start its asynchronous cancellation connection")
	}
	if err := tx.Rollback(); err != nil {
		t.Fatal(err)
	}
	// Observe completion on the exact backend before checking rows: an immediate
	// SELECT could otherwise beat the INSERT and incorrectly pass.
	waitFor(t, "owned backend finished its canceled INSERT", func() bool {
		var finished bool
		return watch.QueryRow(`SELECT EXISTS (SELECT 1 FROM pg_stat_activity
			WHERE datname=current_database() AND pid=$1 AND state LIKE 'idle%'
			AND query LIKE 'INSERT INTO server_logs%')`, writerPID).Scan(&finished) == nil && finished
	})
	// Release pgx cleanup and prove the backend is gone, including any transaction
	// rollback, before asserting absence of the original and post-stop markers.
	release()
	waitFor(t, "owned backend cleanup", func() bool {
		var exists bool
		return watch.QueryRow("SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE pid=$1)", writerPID).Scan(&exists) == nil && !exists
	})
	s.add(LogLine{Level: "info", Text: marker + "-after-stop"})
	if n := serverLogsMarkerCount(t, watch, marker); n != 0 {
		t.Errorf("canceled owned INSERT persisted after StopDB: %d", n)
	}
	if n := serverLogsMarkerCount(t, watch, marker+"-after-stop"); n != 0 {
		t.Errorf("post-stop owned line persisted: %d", n)
	}
}
