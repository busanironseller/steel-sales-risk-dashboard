/**
 * 30-minute candlestick chart — dark terminal theme.
 */
import { useEffect, useRef } from 'react';
import { createChart, CandlestickSeries, HistogramSeries, ColorType, type IChartApi } from 'lightweight-charts';
import type { Bar } from './types';

interface Props {
  bars: Bar[];
  height?: number;
}

function toTimeValue(t: string): number {
  return Math.floor(Date.parse(t.replace(' ', 'T') + 'Z') / 1000);
}

export function Chart({ bars, height = 280 }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || bars.length === 0) return;

    const chart = createChart(el, {
      height,
      layout: {
        background: { type: ColorType.Solid, color: '#0c1219' },
        textColor: '#4d5b6b',
        fontFamily: "ui-monospace, 'Cascadia Mono', Consolas, monospace",
        fontSize: 10,
      },
      grid: {
        vertLines: { color: 'rgba(30, 42, 56, 0.5)' },
        horzLines: { color: 'rgba(30, 42, 56, 0.5)' },
      },
      rightPriceScale: {
        borderColor: '#1e2a38',
        scaleMargins: { top: 0.08, bottom: 0.26 },
      },
      timeScale: {
        borderColor: '#1e2a38',
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 3,
      },
      crosshair: {
        mode: 0,
        horzLine: { color: 'rgba(79, 195, 247, 0.3)', style: 2 },
        vertLine: { color: 'rgba(79, 195, 247, 0.3)', style: 2 },
      },
      handleScale: { axisPressedMouseMove: false },
    });
    chartRef.current = chart;

    const candles = chart.addSeries(CandlestickSeries, {
      upColor: '#69f0ae',
      downColor: '#ff5252',
      borderUpColor: '#69f0ae',
      borderDownColor: '#ff5252',
      wickUpColor: '#69f0ae',
      wickDownColor: '#ff5252',
      priceLineVisible: false,
    });

    const volume = chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' },
      priceScaleId: 'vol',
      color: '#1e2a38',
    });
    chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });

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
        color: b.source === 'SHFE' ? 'rgba(79, 195, 247, 0.25)' : 'rgba(79, 195, 247, 0.08)',
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
        데이터 없음
      </div>
    );
  }

  return <div ref={containerRef} style={{ height }} />;
}
