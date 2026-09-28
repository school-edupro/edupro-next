import { createHash } from 'node:crypto';
import { datasetOrNull, rendererOrNull, tenantForJob, type Db } from '@edupro/db';
import { objectKeyFor, type StorageDriver } from '@edupro/storage';
import type { Logger } from '../logger';
import {
  type Row,
  type TallyOptions,
  toCsv,
  toHtml,
  toTallyXml,
  toXlsx,
  toXml,
} from './generators';
import type { JobLike } from './notifications';
import type { PdfEngine } from './pdf';
import { renderDocument } from '../renderers/document';
import { idCardHtml, loadIdCard } from '../renderers/id-card';

interface ExportDbRow {
  id: string;
  dataset: string;
  format: 'xlsx' | 'csv' | 'pdf' | 'xml';
  params: Record<string, unknown>;
  title: string;
  status: string;
  requested_by: string | null;
  requested_by_name: string | null;
  school_name: string;
}

const CONTENT_TYPES = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv',
  pdf: 'application/pdf',
  xml: 'application/xml',
} as const;

export interface ExportDeps {
  db: Db;
  storage: StorageDriver;
  pdf: PdfEngine;
  log: Logger;
  ttlDays: number;
}

/**
 * Generates one export (S3-03): runs the dataset query under the requester's tenant context, renders the
 * file, writes it through the storage driver, registers it in `files` and marks the export ready. The
 * signed download URL is issued by the API on request.
 */
export function exportProcessor({ db, storage, pdf, log, ttlDays }: ExportDeps) {
  return async (job: JobLike<{ exportId: string }>): Promise<void> => {
    const envelope = job.data;
    if (envelope.kind !== 'export.generate') {
      log.warn({ kind: envelope.kind }, 'unknown export job kind');
      return;
    }
    const exportId = envelope.payload.exportId;
    const tenant = tenantForJob(envelope);

    const row = await db.withTenant(tenant, async (c) => {
      const r = await c.query<ExportDbRow>(
        `SELECT e.id::text, e.dataset, e.format, e.params, e.title, e.status, e.requested_by::text,
                u.display_name AS requested_by_name, s.name AS school_name
           FROM exports e
           JOIN schools s ON s.id = e.school_id
           LEFT JOIN users u ON u.id = e.requested_by
          WHERE e.id = $1`,
        [exportId],
      );
      return r.rows[0] ?? null;
    });
    if (!row) {
      log.warn({ exportId }, 'export not found');
      return;
    }
    if (row.status === 'ready' || row.status === 'expired') return;

    await db.withTenant(tenant, (c) =>
      c.query(
        "UPDATE exports SET status = 'running', started_at = now(), error = NULL WHERE id = $1",
        [exportId],
      ),
    );

    /** Writes the bytes through the storage driver, registers the file and marks the export ready. */
    const store = async (bytes: Buffer, contentType: string, rowCount: number): Promise<void> => {
      const objectKey = objectKeyFor(envelope.schoolId, row.format, `export-${exportId}`);
      await storage.write(objectKey, bytes, contentType);
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      const fileName = `${row.title.replace(/[^\w.-]+/g, '_')}-${exportId}.${row.format}`;
      await db.withTenant(tenant, async (c) => {
        const f = await c.query<{ id: string }>(
          `INSERT INTO files (school_id, bucket, object_key, content_type, size_bytes, sha256, original_name, owner_entity_type, owner_entity_id,
                              classification, storage_driver, status, scanned_at, scan_result, created_by, updated_by)
           VALUES (app.current_school_id(), $1, $2, $3, $4, $5, $6, 'exports', $7, 'internal', $8, 'ready', now(), 'generated', $9, $9)
           RETURNING id::text`,
          [
            storage.bucket,
            objectKey,
            contentType,
            bytes.length,
            sha256,
            fileName,
            exportId,
            storage.name,
            row.requested_by,
          ],
        );
        await c.query(
          `UPDATE exports SET status = 'ready', file_id = $2, row_count = $3, finished_at = now(),
                  expires_at = now() + make_interval(days => $4) WHERE id = $1`,
          [exportId, f.rows[0]!.id, rowCount, ttlDays],
        );
      });
    };

    try {
      const renderer = rendererOrNull(row.dataset);
      if (renderer) {
        let bytes: Buffer;
        if (renderer.id === 'document') {
          const doc = await renderDocument(db, envelope, row.params);
          bytes = await pdf.render(doc.html, { width: doc.width, height: doc.height });
        } else {
          const data = await loadIdCard(db, storage, envelope, renderer.id, row.params);
          bytes = await pdf.render(idCardHtml(data), {
            width: renderer.page.width,
            height: renderer.page.height,
          });
        }
        await store(bytes, 'application/pdf', 1);
        log.info({ exportId, renderer: renderer.id, bytes: bytes.length }, 'document rendered');
        return;
      }
      const dataset = datasetOrNull(row.dataset);
      if (!dataset) throw new Error(`unknown dataset ${row.dataset}`);
      const query = dataset.query(row.params);
      const academicYearId =
        typeof row.params.academicYearId === 'string' ? row.params.academicYearId : null;
      let tally: TallyOptions | null = null;
      const rows = await db.withTenant(tenantForJob(envelope, academicYearId), async (c) => {
        const r = await c.query<Row>(
          query.text + ' LIMIT ' + String(dataset.maxRows),
          query.values,
        );
        if (row.format === 'xml' && dataset.id === 'fee_tally_vouchers') {
          const st = await c.query<{ cash: string | null; bank: string | null }>(
            "SELECT app.setting('fees.tally.cash_ledger') #>> '{}' AS cash, app.setting('fees.tally.bank_ledger') #>> '{}' AS bank",
          );
          tally = {
            company: row.school_name,
            cashLedger: st.rows[0]?.cash ?? 'Cash',
            bankLedger: st.rows[0]?.bank ?? 'Bank',
          };
        }
        return r.rows;
      });

      const meta = {
        school: row.school_name,
        generatedAt: new Date(),
        requestedBy: row.requested_by_name,
      };
      let bytes: Buffer;
      if (row.format === 'xlsx') bytes = await toXlsx(row.title, dataset.columns, rows, meta);
      else if (row.format === 'csv') bytes = toCsv(dataset.columns, rows);
      else if (row.format === 'xml')
        bytes = tally ? toTallyXml(rows, tally) : toXml(row.title, dataset.columns, rows);
      else
        bytes = await pdf.render(toHtml(row.title, dataset.columns, rows, meta), {
          landscape: dataset.columns.length > 6,
        });

      await store(bytes, CONTENT_TYPES[row.format], rows.length);
      log.info(
        {
          exportId,
          dataset: row.dataset,
          format: row.format,
          rows: rows.length,
          bytes: bytes.length,
        },
        'export ready',
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const lastAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
      await db.withTenant(tenant, (c) =>
        c.query(
          "UPDATE exports SET status = CASE WHEN $3 THEN 'failed'::export_status ELSE 'queued'::export_status END, error = left($2, 1000), finished_at = CASE WHEN $3 THEN now() ELSE NULL END WHERE id = $1",
          [exportId, message, lastAttempt],
        ),
      );
      log.error({ exportId, err: message, lastAttempt }, 'export failed');
      throw error;
    }
  };
}
