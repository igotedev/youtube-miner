import {
  fromNullableDate,
  toCount,
  toDate,
  toEnumValue,
  toNullableDate,
  toNullableText,
  toText,
  toUuid,
} from '@/shared/infrastructure/persistence/row-mappers';

import {
  COLLECTION_RUN_STATUSES,
  type CollectionRun,
  type CollectionRunId,
  type CollectionRunStatus,
} from '../../domain/collection-run';
import type { YouTubeChannel, YouTubeChannelId } from '../../domain/youtube-channel';
import { VIDEO_FORMATS } from '../../domain/youtube-video';
import type { VideoFormat, YouTubeVideo, YouTubeVideoId } from '../../domain/youtube-video';

/**
 * Traducao entre as linhas do banco e os tipos de dominio.
 *
 * Toda linha lida passa por aqui, e uma linha que nao possa virar entidade
 * FALHA com `CorruptedPersistedDataError`. Nao existe caminho que produza uma
 * entidade com campo errado silenciosamente: e sempre preferivel quebrar do que
 * calcular metricas sobre dado invalido.
 *
 * O `id` interno (uuid) e o `youtube_channel_id` (`UC...`) sao coisas DIFERENTES
 * e nao podem ser confundidos. As FKs usam o uuid; o dominio fala `UC...`.
 */

/** Versao do formato do payload bruto guardado. Muda se a forma da API mudar. */
export const SOURCE_SCHEMA_VERSION = 'youtube-data-api-v3/1';

// ---------------------------------------------------------------------------
// Execucao de coleta
// ---------------------------------------------------------------------------

export interface CollectionRunRow {
  readonly id: unknown;
  readonly status: unknown;
  readonly requested_at: unknown;
  readonly started_at: unknown;
  readonly captured_at: unknown;
  readonly completed_at: unknown;
  readonly failed_at: unknown;
  readonly reusable_until: unknown;
  readonly invalidated_at: unknown;
  readonly error_code: unknown;
  /** Vem do join com `youtube_channels`, porque o dominio fala `UC...`. */
  readonly youtube_channels: unknown;
}

/** Extrai o `UC...` do objeto aninhado que o PostgREST devolve no join. */
function toChannelIdFromJoin(value: unknown, field: string): YouTubeChannelId {
  // PostgREST devolve objeto para relacao 1:1 e array quando nao consegue
  // inferir cardinalidade. Aceitamos as duas formas.
  const node = Array.isArray(value) ? value[0] : value;
  if (typeof node !== 'object' || node === null) {
    throw new TypeError(`${field}: join com youtube_channels ausente`);
  }
  const raw = (node as Record<string, unknown>)['youtube_channel_id'];
  return toText(raw, `${field}.youtube_channel_id`) as YouTubeChannelId;
}

export function toCollectionRun(row: CollectionRunRow): CollectionRun {
  return {
    id: toUuid(row.id, 'collectionRun.id') as CollectionRunId,
    channelId: toChannelIdFromJoin(row.youtube_channels, 'collectionRun.channel'),
    status: toEnumValue<CollectionRunStatus>(
      row.status,
      COLLECTION_RUN_STATUSES,
      'collectionRun.status',
    ),
    requestedAt: toDate(row.requested_at, 'collectionRun.requestedAt'),
    startedAt: toNullableDate(row.started_at, 'collectionRun.startedAt'),
    capturedAt: toNullableDate(row.captured_at, 'collectionRun.capturedAt'),
    completedAt: toNullableDate(row.completed_at, 'collectionRun.completedAt'),
    failedAt: toNullableDate(row.failed_at, 'collectionRun.failedAt'),
    reusableUntil: toNullableDate(row.reusable_until, 'collectionRun.reusableUntil'),
    invalidatedAt: toNullableDate(row.invalidated_at, 'collectionRun.invalidatedAt'),
    errorCode: toNullableText(row.error_code, 'collectionRun.errorCode'),
  };
}

/** Campos gravaveis de uma execucao. `channel_id` interno entra a parte. */
export function fromCollectionRun(run: CollectionRun): Record<string, unknown> {
  return {
    status: run.status,
    requested_at: fromNullableDate(run.requestedAt, 'collectionRun.requestedAt'),
    started_at: fromNullableDate(run.startedAt, 'collectionRun.startedAt'),
    captured_at: fromNullableDate(run.capturedAt, 'collectionRun.capturedAt'),
    completed_at: fromNullableDate(run.completedAt, 'collectionRun.completedAt'),
    failed_at: fromNullableDate(run.failedAt, 'collectionRun.failedAt'),
    reusable_until: fromNullableDate(run.reusableUntil, 'collectionRun.reusableUntil'),
    invalidated_at: fromNullableDate(run.invalidatedAt, 'collectionRun.invalidatedAt'),
    error_code: run.errorCode,
  };
}

// ---------------------------------------------------------------------------
// Snapshot do canal
// ---------------------------------------------------------------------------

/**
 * Reconstroi o canal a partir do payload BRUTO guardado.
 *
 * O bruto e a fonte, e nao as colunas denormalizadas de `youtube_channels`:
 * aquelas refletem a ULTIMA coleta e teriam mudado desde esta. Reaproveitar uma
 * coleta de ontem com o nome de hoje misturaria dois instantes.
 */
export function toYouTubeChannel(
  payload: Record<string, unknown>,
  channelId: YouTubeChannelId,
): YouTubeChannel {
  return {
    id: channelId,
    title: toText(payload['title'], 'channelSnapshot.title'),
    handle: toNullableText(payload['handle'], 'channelSnapshot.handle'),
    description: typeof payload['description'] === 'string' ? payload['description'] : '',
    publishedAt: toDate(payload['publishedAt'], 'channelSnapshot.publishedAt'),
    country: toNullableText(payload['country'], 'channelSnapshot.country'),
    subscriberCount: toCount(payload['subscriberCount'], 'channelSnapshot.subscriberCount'),
    hiddenSubscriberCount: payload['hiddenSubscriberCount'] === true,
    videoCount: toCount(payload['videoCount'], 'channelSnapshot.videoCount'),
    viewCount: toCount(payload['viewCount'], 'channelSnapshot.viewCount'),
  };
}

/** Serializa o canal para o `jsonb` do snapshot. */
export function fromYouTubeChannel(channel: YouTubeChannel): Record<string, unknown> {
  return {
    id: channel.id,
    title: channel.title,
    handle: channel.handle,
    description: channel.description,
    publishedAt: channel.publishedAt.toISOString(),
    country: channel.country,
    subscriberCount: channel.subscriberCount,
    hiddenSubscriberCount: channel.hiddenSubscriberCount,
    videoCount: channel.videoCount,
    viewCount: channel.viewCount,
  };
}

// ---------------------------------------------------------------------------
// Snapshots de video
// ---------------------------------------------------------------------------

export interface VideoSnapshotRow {
  readonly youtube_video_id: unknown;
  readonly title: unknown;
  readonly published_at: unknown;
  readonly duration_seconds: unknown;
  readonly format: unknown;
  readonly view_count: unknown;
  readonly like_count: unknown;
  readonly comment_count: unknown;
}

/**
 * Video reconstruido das COLUNAS, nao do `raw_payload`.
 *
 * As colunas extraidas sao as que o banco valida (contagem nao negativa, formato
 * entre os tres permitidos) e as que o motor de metricas consome. O `raw_payload`
 * fica para auditoria e para reprocessar se a extracao mudar.
 */
export function toYouTubeVideo(row: VideoSnapshotRow, channelId: YouTubeChannelId): YouTubeVideo {
  return {
    id: toText(row.youtube_video_id, 'videoSnapshot.id') as YouTubeVideoId,
    channelId,
    title: toText(row.title, 'videoSnapshot.title'),
    publishedAt: toDate(row.published_at, 'videoSnapshot.publishedAt'),
    durationSeconds: toCount(row.duration_seconds, 'videoSnapshot.durationSeconds'),
    format: toEnumValue<VideoFormat>(row.format, VIDEO_FORMATS, 'videoSnapshot.format'),
    viewCount: toCount(row.view_count, 'videoSnapshot.viewCount'),
    likeCount: toCount(row.like_count, 'videoSnapshot.likeCount'),
    commentCount: toCount(row.comment_count, 'videoSnapshot.commentCount'),
  };
}

/** Serializa um video para o array `jsonb` que a funcao `complete_collection_run` recebe. */
export function fromYouTubeVideo(video: YouTubeVideo): Record<string, unknown> {
  return {
    youtube_video_id: video.id,
    title: video.title,
    published_at: video.publishedAt.toISOString(),
    duration_seconds: video.durationSeconds,
    format: video.format,
    view_count: video.viewCount,
    like_count: video.likeCount,
    comment_count: video.commentCount,
    raw_payload: {
      id: video.id,
      title: video.title,
      publishedAt: video.publishedAt.toISOString(),
      durationSeconds: video.durationSeconds,
      format: video.format,
      viewCount: video.viewCount,
      likeCount: video.likeCount,
      commentCount: video.commentCount,
    },
  };
}
