/**
 * 30-minute candlestick chart.
 *
 * Bars are placed on a category-style index rather than real time, because the
 * series deliberately has holes: session breaks and overnight gaps are not
 * tradeable and drawing them as empty space would misrepresent the tape.
 */
import { useEffect, useRef } from 'react';
import { createChart, CandlestickSeries, HistogramSeries, ColorType, type IChartApi } from 'lightweight-charts';
import type { Bar } from './types';

interface Props {
  bars: Bar[];
  height?: number;
}

/** Bar label "2026-08-18 09:00:00" (exchange local time) → chart time value. */
function toTimeValue(t: string): number {
  return Math.floor(Date.parse(t.replace(' ', 'T') + 'Z') / 1000);
}

export function Chart({ bars, height = 260 }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || bars.length === 0) return;

    const chart = createChart(el, {
      height,
      layout: {
        background: { type: ColorType.Solid, color: '#ffffff' },
        textColor: '#6b7683',
        fontFamily: "ui-monospace, 'Cascadia Mono', Consolas, monospace",
        fontSize: 10,
      },
      grid: {
        vertLines: { color: '#eef1f4' },
        horzLines: { color: '#eef1f4' },
      },
      rightPriceScale: { borderColor: '#d8dde4', scaleMargins: { top: 0.08, bottom: 0.26 } },
      timeScale: { borderColor: '#d8dde4', timeVisible: true, secondsVisible: false, rightOffset: 3 },
      crosshair: { mode: 0 },
      handleScale: { axisPressedMouseMove: false },
    });
    chartRef.current = chart;

    const candles = chart.addSeries(CandlestickSeries, {
      upColor: '#1d6f42',
      downColor: '#b3261e',
      borderUpColor: '#1d6f42',
      borderDownColor: '#b3261e',
      wickUpColor: '#1d6f42',
      wickDownColor: '#b3261e',
      priceLineVisible: false,
    });

    const volume = chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' },
      priceScaleId: 'vol',
      color: '#c9d3dc',
    });
    chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });

    // Duplicate timestamps would throw; the collector already dedupes, this guards
    // against a backfill/official overlap slipping through.
    const seen = new Set<number>();
    const candleData = [];
    const volumeData = [];
    for (const b of bars) {
      const time = toTimeValue(b.t);
      if (!Number.isFinite(time) || seen.has(time)) continue;
      seen.add(time);
      candleData.push({ time: time as never, open: b.o, high: b.h, low: b.l, close: b.c });
      volumeData.push({
        time: time as never,
        value: b.v ?? 0,
        // Official SHFE bars read at full strength; backfilled bars are muted so
        // the eye can tell which part of the tape is exchange-sourced.
        color: b.source === 'SHFE' ? '#8fa3b4' : '#dce3e9',
      });
    }

    candles.setData(candleData);
    volume.setData(volumeData);
    chart.timeScale().fitContent();

    const observer = new ResizeObserver(() => chart.applyOptions({ width: el.clientWidth }));
    observer.observe(el);
    chart.applyOptions({ width: el.clientWidth });

    return () => {
      observer.disconnect();
      chart.remove();
      chartRef.current = null;
    };
  }, [bars, height]);

  if (bars.length === 0) {
    return (
      <div className="flex items-center justify-center text-[11px] text-[var(--color-faint)]" style={{ height }}>
        NO BARS AVAILABLE
      </div>
    );
  }

  return <div ref={containerRef} style={{ height }} />;
}
