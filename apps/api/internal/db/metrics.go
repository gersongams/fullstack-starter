package db

import (
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/prometheus/client_golang/prometheus"
)

// poolCollector exports the connection pool's counters. A pool that is always
// at max_conns with a growing wait count is the first sign of slow queries or
// a pool that is too small.
type poolCollector struct {
	pool *pgxpool.Pool

	acquired, idle, total, maxConns *prometheus.Desc
	acquires, emptyAcquires, waited *prometheus.Desc
}

// NewPoolCollector returns a Prometheus collector for the pool's statistics.
func NewPoolCollector(pool *pgxpool.Pool) prometheus.Collector {
	desc := func(name, help string) *prometheus.Desc {
		return prometheus.NewDesc("db_pool_"+name, help, nil, nil)
	}
	return &poolCollector{
		pool:          pool,
		acquired:      desc("acquired_connections", "Connections currently in use."),
		idle:          desc("idle_connections", "Connections currently idle."),
		total:         desc("total_connections", "Connections currently open."),
		maxConns:      desc("max_connections", "Maximum size of the pool."),
		acquires:      desc("acquires_total", "Successful connection acquisitions."),
		emptyAcquires: desc("empty_acquires_total", "Acquisitions that had to wait because the pool was empty."),
		waited:        desc("acquire_wait_seconds_total", "Total time spent waiting for a connection."),
	}
}

func (c *poolCollector) Describe(ch chan<- *prometheus.Desc) {
	for _, d := range []*prometheus.Desc{c.acquired, c.idle, c.total, c.maxConns, c.acquires, c.emptyAcquires, c.waited} {
		ch <- d
	}
}

func (c *poolCollector) Collect(ch chan<- prometheus.Metric) {
	stat := c.pool.Stat()
	gauge := func(d *prometheus.Desc, v float64) {
		ch <- prometheus.MustNewConstMetric(d, prometheus.GaugeValue, v)
	}
	counter := func(d *prometheus.Desc, v float64) {
		ch <- prometheus.MustNewConstMetric(d, prometheus.CounterValue, v)
	}
	gauge(c.acquired, float64(stat.AcquiredConns()))
	gauge(c.idle, float64(stat.IdleConns()))
	gauge(c.total, float64(stat.TotalConns()))
	gauge(c.maxConns, float64(stat.MaxConns()))
	counter(c.acquires, float64(stat.AcquireCount()))
	counter(c.emptyAcquires, float64(stat.EmptyAcquireCount()))
	counter(c.waited, stat.AcquireDuration().Seconds())
}
