/**
 * Multi-timeframe candlestick chart — theme-aware.
 * Supports 30min, daily, weekly, monthly views.
 */
import { useEffect, useRef, useMemo } from 'react';
import { createChart, CandlestickSeries, HistogramSeries, ColorType, type IChartApi } from 'lightweight-charts';
import type { Bar } from './types';

export type Timeframe = '30m' | 'daily' | 'weekly' | 'monthly';

interface Props {
  bars: Bar[];
  daily?: Bar[];
  height?: number;
  theme?: 'dark' | 'light';
  timeframe?: Timeframe;
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
    tooltip: '#0c1219',
    tooltipText: '#e8ecf1',
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
    tooltip: '#ffffff',
    tooltipText: '#1a2332',
  },
};

/** Aggregate daily bars into weekly (Mon-Fri) bars. */
function aggregateWeekly(dailyBars: Bar[]): Bar[] {
  if (dailyBars.length === 0) return [];
  const weeks: Bar[] = [];
  let current: Bar | null = null;

  for (const bar of dailyBars) {
    const d = new Date(bar.t.replace(' ', 'T') + 'Z');
    const day = d.getUTCDay();
    // Start new week on Monday (day 1), or if no current bar
    if (!current || day === 1) {
      if (current) weeks.push(current);
      current = { ...bar, v: bar.v ?? 0, oi: bar.oi };
    } else {
      current.h = Math.max(current.h, bar.h);
      current.l = Math.min(current.l, bar.l);
      current.c = bar.c;
      current.v = (current.v ?? 0) + (bar.v ?? 0);
      current.oi = bar.oi;
    }
  }
  if (current) weeks.push(current);
  return weeks;
}

/** Aggregate daily bars into monthly bars. */
function aggregateMonthly(dailyBars: Bar[]): Bar[] {
  if (dailyBars.length === 0) return [];
  const months: Bar[] = [];
  let current: Bar | null = null;
  let currentMonth = '';

  for (const bar of dailyBars) {
    const month = bar.t.slice(0, 7); // YYYY-MM
    if (month !== currentMonth) {
      if (current) months.push(current);
      current = { ...bar, v: bar.v ?? 0, oi: bar.oi };
      currentMonth = month;
    } else if (current) {
      current.h = Math.max(current.h, bar.h);
      current.l = Math.min(current.l, bar.l);
      current.c = bar.c;
      current.v = (current.v ?? 0) + (bar.v ?? 0);
      current.oi = bar.oi;
    }
  }
  if (current) months.push(current);
  return months;
}

export function Chart({ bars, daily = [], height = 280, theme = 'dark', timeframe = '30m' }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  // Select and aggregate bars based on timeframe
  const displayBars = useMemo(() => {
    switch (timeframe) {
      case '30m': return bars.slice(-160);
      case 'daily': return daily;
      case 'weekly': return aggregateWeekly(daily);
      case 'monthly': return aggregateMonthly(daily);
      default: return bars;
    }
  }, [bars, daily, timeframe]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || displayBars.length === 0) return;

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
        timeVisible: timeframe === '30m',
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
      priceLineVisible: true,
    });

    const volume = chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' },
      priceScaleId: 'vol',
      color: t.volBase,
    });
    chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });

    const seen = new Set<number>();
    const candleData: any[] = [];
    const volumeData: any[] = [];
    for (const b of displayBars) {
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

    // Tooltip with percentage change
    const tooltip = tooltipRef.current;
    if (tooltip) {
      chart.subscribeCrosshairMove((param) => {
        if (!param.time || !param.seriesData.has(candles)) {
          tooltip.style.display = 'none';
          return;
        }
        const data = param.seriesData.get(candles) as any;
        if (!data) { tooltip.style.display = 'none'; return; }
        const pctChange = ((data.close - data.open) / data.open * 100).toFixed(2);
        const sign = Number(pctChange) >= 0 ? '+' : '';
        const color = Number(pctChange) >= 0 ? t.down : t.up;
        tooltip.innerHTML = `
          <div style="font-size:10px;color:${t.text}">O ${data.open.toLocaleString()} H ${data.high.toLocaleString()} L ${data.low.toLocaleString()} C ${data.close.toLocaleString()}</div>
          <div style="font-size:12px;font-weight:bold;color:${color}">${sign}${pctChange}%</div>
        `;
        tooltip.style.display = 'block';
      });
    }

    const observer = new ResizeObserver(() => chart.applyOptions({ width: el.clientWidth }));
    observer.observe(el);
    chart.applyOptions({ width: el.clientWidth });

    return () => {
      observer.disconnect();
      chart.remove();
      chartRef.current = null;
    };
  }, [displayBars, height, theme, timeframe]);

  if (displayBars.length === 0) {
    return (
      <div className="flex items-center justify-center text-[11px] text-[var(--color-faint)]" style={{ height }}>
        {timeframe === '30m' ? '30분봉 데이터 없음' : `${timeframe} 데이터 없음`}
      </div>
    );
  }

  return (
    <div style={{ position: 'relative' }}>
      <div
        ref={tooltipRef}
        style={{
          position: 'absolute',
          top: 8,
          left: 8,
          zIndex: 10,
          pointerEvents: 'none',
          display: 'none',
          fontFamily: "ui-monospace, 'Cascadia Mono', Consolas, monospace",
        }}
      />
      <div ref={containerRef} style={{ height }} />
    </div>
  );
}
