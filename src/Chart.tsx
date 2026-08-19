/**
 * 30-minute candlestick chart — theme-aware.
 */
import { useEffect, useRef } from 'react';
import { createChart, CandlestickSeries, HistogramSeries, ColorType, type IChartApi } from 'lightweight-charts';
import type { Bar } from './types';

interface Props {
  bars: Bar[];
  height?: number;
  theme?: 'dark' | 'light';
}

function toTimeValue(t: string): number {
  return Math.floor(Date.parse(t.replace(' ', 'T') + 'Z') / 1000);
}

const THEMES = {
  dark: {
    bg: '#0c1219',
    text: '#4d5b6b',
    grid: 'rgba(30, 42, 56, 0.5)',
    border: '#1e2a38',
    crosshair: 'rgba(79, 195, 247, 0.3)',
    up: '#69f0ae',
    down: '#ff5252',
    volBright: 'rgba(79, 195, 247, 0.25)',
    volDim: 'rgba(79, 195, 247, 0.08)',
    volBase: '#1e2a38',
  },
  light: {
    bg: '#ffffff',
    text: '#8a96a3',
    grid: 'rgba(213, 219, 227, 0.5)',
    border: '#d5dbe3',
    crosshair: 'rgba(21, 101, 192, 0.3)',
    up: '#2e7d32',
    down: '#c62828',
    volBright: 'rgba(21, 101, 192, 0.25)',
    volDim: 'rgba(21, 101, 192, 0.08)',
    volBase: '#e0e5eb',
  },
};

export function Chart({ bars, height = 280, theme = 'dark' }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || bars.length === 0) return;

    const t = THEMES[theme];

    const chart = createChart(el, {
      height,
      layout: {
        background: { type: ColorType.Solid, color: t.bg },
        textColor: t.text,
        fontFamily: "ui-monospace, 'Cascadia Mono', Consolas, monospace",
        fontSize: 10,
      },
      grid: {
        vertLines: { color: t.grid },
        horzLines: { color: t.grid },
      },
      rightPriceScale: {
        borderColor: t.border,
        scaleMargins: { top: 0.08, bottom: 0.26 },
      },
      timeScale: {
        borderColor: t.border,
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 3,
      },
      crosshair: {
        mode: 0,
        horzLine: { color: t.crosshair, style: 2 },
        vertLine: { color: t.crosshair, style: 2 },
      },
      handleScale: { axisPressedMouseMove: false },
    });
    chartRef.current = chart;

    const candles = chart.addSeries(CandlestickSeries, {
      upColor: t.up,
      downColor: t.down,
      borderUpColor: t.up,
      borderDownColor: t.down,
      wickUpColor: t.up,
      wickDownColor: t.down,
      priceLineVisible: false,
    });

    const volume = chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' },
      priceScaleId: 'vol',
      color: t.volBase,
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
        color: b.source === 'SHFE' ? t.volBright : t.volDim,
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
  }, [bars, height, theme]);

  if (bars.length === 0) {
    return (
      <div className="flex items-center justify-center text-[11px] text-[var(--color-faint)]" style={{ height }}>
        데이터 없음
      </div>
    );
  }

  return <div ref={containerRef} style={{ height }} />;
}
