import type { FormatMetrics } from '@/modules/video-analytics';

import { formatCount, formatDecimal, formatIntervalDays, formatOutlierBand } from './format';

/**
 * Painel de UM formato. Recebe `FormatMetrics` e nada mais.
 *
 * O tipo e a garantia da RN-06: nao existe um objeto com "metricas do canal"
 * misturando Shorts e longos, entao a tela nao teria como exibir uma media
 * unica nem que quisesse. Dois paineis, lado a lado, sem total agregado.
 */

interface MetricsPanelProps {
  readonly title: string;
  readonly caption: string;
  readonly metrics: FormatMetrics;
}

function Row({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="font-mono text-sm tabular-nums">{value}</dd>
    </div>
  );
}

export function MetricsPanel({ title, caption, metrics }: MetricsPanelProps) {
  return (
    <section className="flex flex-col gap-3 rounded-lg border border-border p-4">
      <header className="flex flex-col gap-1">
        <h3 className="text-sm font-semibold tracking-wide uppercase">{title}</h3>
        <p className="text-xs text-muted">{caption}</p>
      </header>

      <dl className="divide-y divide-border">
        <Row label="Videos" value={formatCount(metrics.videoCount)} />
        <Row label="Sem contagem de views" value={formatCount(metrics.videosWithoutViewCount)} />

        <Row label="Views — mediana" value={formatCount(metrics.viewCount.median)} />
        <Row label="Views — media" value={formatCount(metrics.viewCount.average)} />
        <Row label="Views — minimo" value={formatCount(metrics.viewCount.minimum)} />
        <Row label="Views — maximo" value={formatCount(metrics.viewCount.maximum)} />

        <Row label="Views/dia — mediana" value={formatDecimal(metrics.viewsPerDay.median)} />
        <Row label="Views/dia — media" value={formatDecimal(metrics.viewsPerDay.average)} />

        <Row
          label="Intervalo entre posts — mediana"
          value={formatIntervalDays(metrics.publicationFrequency.medianIntervalDays)}
        />
        <Row
          label="Videos nos ultimos 30 dias"
          value={formatCount(metrics.publicationFrequency.videosLast30Days)}
        />

        <Row label="Fora da curva" value={formatCount(metrics.outliers.count)} />
        <Row label="Muito fora da curva" value={formatCount(metrics.outliers.largeCount)} />
        <Row label="Nao classificaveis" value={formatCount(metrics.outliers.unavailableCount)} />
      </dl>

      {metrics.videos.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-muted">Videos deste formato</summary>
          <ul className="mt-2 divide-y divide-border">
            {metrics.videos.map((video) => (
              <li key={video.videoId} className="flex items-baseline justify-between gap-4 py-1.5">
                <span className="font-mono text-xs">{video.videoId}</span>
                <span className="text-xs text-muted">
                  {formatOutlierBand(video.outlierBand)} · {formatDecimal(video.viewsPerDay)}/dia
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
