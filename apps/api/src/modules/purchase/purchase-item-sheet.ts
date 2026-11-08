import type { PoolClient } from '@edupro/db';
import { readSheet, templateSheet } from '../../common/excel/sheet';
import { DomainError } from '../../common/errors/domain-error';

/**
 * The item sheet of an indent and of a direct requisition (docs/design/83, "As built — indent items from
 * Excel" and "— direct requisition items from Excel"): the item list as a drop-down, the quantity, a
 * note, an item in words with its unit; the requisition's also the estimated rate. Reading it fills the
 * form's lines — nothing is saved — and gives back the rows it could not read, by row number.
 */
export interface SheetKind {
  /** the sheet's tab and file name */
  sheet: string;
  file: string;
  /** what the rows fill, for the guide: "the indent", "the requisition" */
  on: string;
  /** an Est. rate (₹) column (the purchase office's requisition) */
  rate: boolean;
  /** the same item twice: one line, quantities added (a requisition combines lines by item) */
  merge: boolean;
}

export interface SheetLine {
  itemId?: string;
  freeText?: string;
  uomId?: string;
  quantity: number;
  estRate?: number;
  note?: string;
}

const MAX_LINES = 200;

export async function itemSheetBytes(c: PoolClient, k: SheetKind) {
  const items = await c.query<{ label: string }>(
    `SELECT i.name || ' (' || i.code || ')' AS label FROM purchase_items i
      WHERE i.status = 'active' ORDER BY i.name LIMIT 5000`,
  );
  const uoms = await c.query<{ code: string }>(
    `SELECT code FROM purchase_uoms WHERE status = 'active' ORDER BY code`,
  );
  const bytes = await templateSheet({
    sheet: k.sheet,
    columns: [
      {
        header: 'Item',
        width: 46,
        options: items.rows.map((x) => x.label),
        note: 'Pick from the list (the code in brackets is read). Leave it empty for an item not in the list',
      },
      { header: 'Quantity', width: 11, required: true, format: 'number' },
      ...(k.rate
        ? [
            {
              header: 'Est. rate (₹)',
              width: 13,
              format: 'number' as const,
              note: 'Before GST, per unit. Empty: the item’s list rate (rate contract, else last purchase)',
            },
          ]
        : []),
      { header: 'Note', width: 32, note: 'Size, make, colour… (optional)' },
      { header: 'Description', width: 36, note: 'Only for an item not in the list' },
      {
        header: 'Unit',
        width: 10,
        options: uoms.rows.map((x) => x.code),
        note: 'Only for an item not in the list',
      },
    ],
    guide: [
      'One row per item. Pick the item from the drop-down (or type its code), then the quantity.',
      ...(k.rate
        ? [
            'Est. rate: the estimate before GST per unit; leave it empty for the item’s list rate. The vendor and the quotes are chosen on the requisition’s next page.',
            'The same item on two rows becomes one line, the quantities added.',
          ]
        : []),
      'An item not in the list: leave Item empty, describe it in Description and pick its Unit.',
      `Items counted in whole units take whole numbers. Up to ${String(MAX_LINES)} rows.`,
      `Upload the sheet on ${k.on}: the rows fill its Items, to check before saving. Nothing is saved by the upload.`,
    ],
    examples: [
      [
        items.rows[0]?.label ?? 'Ball pen (PEN)',
        10,
        ...(k.rate ? [null] : []),
        'Blue ink',
        null,
        null,
      ],
      [null, 2, ...(k.rate ? [450] : []), null, 'Bunsen burner', uoms.rows[0]?.code ?? 'NOS'],
    ],
  });
  return {
    filename: k.file,
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    base64: bytes.toString('base64'),
  };
}

/**
 * The filled sheet read into lines: each row an item from the list (by the code in brackets, the code,
 * or the exact name) or one in words with its unit; the rows that cannot be read come back with their
 * row number and why.
 */
export async function readItemRows(c: PoolClient, file: string, k: SheetKind) {
  const rows = await readSheet(
    file,
    ['Item', 'Quantity'],
    [...(k.rate ? ['Est. rate (₹)'] : []), 'Note', 'Description', 'Unit'],
  );
  const items = (
    await c.query<{ id: string; code: string; name: string; decimals: boolean }>(
      `SELECT i.id::text, i.code, i.name, u.decimals FROM purchase_items i JOIN purchase_uoms u ON u.id = i.uom_id
        WHERE i.status = 'active'`,
    )
  ).rows;
  const byCode = new Map(items.map((i) => [i.code.toUpperCase(), i]));
  const names = new Map<string, typeof items>();
  for (const i of items)
    names.set(i.name.toLowerCase(), [...(names.get(i.name.toLowerCase()) ?? []), i]);
  const uoms = new Map(
    (
      await c.query<{ id: string; code: string }>(
        `SELECT id::text, code FROM purchase_uoms WHERE status = 'active'`,
      )
    ).rows.map((u) => [u.code.toUpperCase(), u.id]),
  );
  const lines: SheetLine[] = [];
  /** a merged item's line and the row that first gave it */
  const seen = new Map<string, { line: SheetLine; row: number }>();
  const errors: Array<{ row: number; message: string }> = [];
  for (const r of rows) {
    const cell = r.cells;
    const said = (cell.Item ?? '').trim();
    const qty = Number((cell.Quantity ?? '').replace(/,/g, ''));
    const note = (cell.Note ?? '').trim();
    const rateCell = k.rate ? (cell['Est. rate (₹)'] ?? '').replace(/[,₹\s]/g, '') : '';
    const rate = rateCell === '' ? undefined : Number(rateCell);
    if (!said && !(cell.Description ?? '').trim() && !cell.Quantity) continue;
    if (!Number.isFinite(qty) || qty <= 0 || qty > 999999) {
      errors.push({ row: r.row, message: 'Quantity: a number more than 0' });
      continue;
    }
    if (rate !== undefined && (!Number.isFinite(rate) || rate < 0 || rate > 99_999_999)) {
      errors.push({ row: r.row, message: 'Est. rate: a number in rupees, 0 or more' });
      continue;
    }
    if (note.length > 300) {
      errors.push({ row: r.row, message: 'Note: at most 300 letters' });
      continue;
    }
    const extra = {
      ...(rate !== undefined ? { estRate: Math.round(rate * 100) / 100 } : {}),
      ...(note ? { note } : {}),
    };
    if (said) {
      const code = /\(([^()]+)\)\s*$/.exec(said)?.[1]?.trim().toUpperCase();
      const byName = names.get(said.toLowerCase());
      const it =
        (code ? byCode.get(code) : undefined) ??
        byCode.get(said.toUpperCase()) ??
        (byName?.length === 1 ? byName[0] : undefined);
      if (!it) {
        errors.push({
          row: r.row,
          message: `“${said}” is not in the item list: pick it from the drop-down, or leave Item empty and fill Description and Unit`,
        });
        continue;
      }
      if (!it.decimals && !Number.isInteger(qty)) {
        errors.push({ row: r.row, message: `${it.name}: a whole number` });
        continue;
      }
      const first = k.merge ? seen.get(it.id) : undefined;
      if (first) {
        // one line per item: the quantities added; two different rates for it cannot both stand
        if (
          extra.estRate !== undefined &&
          first.line.estRate !== undefined &&
          extra.estRate !== first.line.estRate
        ) {
          errors.push({
            row: r.row,
            message: `${it.name} is also on row ${String(first.row)} at another rate: one rate per item`,
          });
          continue;
        }
        first.line.quantity = Math.round((first.line.quantity + qty) * 1000) / 1000;
        if (extra.estRate !== undefined) first.line.estRate = extra.estRate;
        if (note)
          first.line.note = [first.line.note, note].filter(Boolean).join('; ').slice(0, 300);
        continue;
      }
      const line: SheetLine = { itemId: it.id, quantity: qty, ...extra };
      lines.push(line);
      if (k.merge) seen.set(it.id, { line, row: r.row });
    } else {
      const words = (cell.Description ?? '').trim();
      const uomId = uoms.get((cell.Unit ?? '').trim().toUpperCase());
      if (words.length < 2 || words.length > 300) {
        errors.push({ row: r.row, message: 'Pick an item, or describe one not in the list' });
        continue;
      }
      if (!uomId) {
        errors.push({
          row: r.row,
          message: 'Unit: pick the unit of an item described in words',
        });
        continue;
      }
      lines.push({ freeText: words, uomId, quantity: qty, ...extra });
    }
  }
  if (lines.length > MAX_LINES)
    throw new DomainError('validation-failed', `At most ${String(MAX_LINES)} lines on ${k.on}`, {
      status: 400,
    });
  return { lines, errors };
}
