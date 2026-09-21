/**
 * Reading CSV, for the bulk-add screens.
 *
 * `services/exportService.js` writes CSV; this reads it. They are deliberately
 * separate files: the writer is about escaping, the reader is about tolerating,
 * and the two sets of rules are not inverses of each other.
 *
 * ## Why not a library
 *
 * The whole grammar that matters here is: rows split on newlines, cells split
 * on commas, a cell may be quoted, and a quoted cell may contain commas,
 * newlines and doubled quotes. That is about forty lines. A dependency would
 * add a supply-chain surface to a feature that parses a file a staff member
 * typed.
 *
 * ## What it tolerates
 *
 * A file people make by hand in Excel, so: a UTF-8 BOM, CRLF or LF, trailing
 * blank lines, and a header row that may or may not be there. Anything it
 * cannot read is reported per row rather than failing the whole import - a
 * hundred-row file with one bad line should add ninety-nine models and say
 * which one it could not.
 */

/**
 * Splits a CSV document into rows of cells.
 *
 * Character by character rather than `split(',')`, because a quoted cell may
 * hold a comma - `"Screens, OLED"` is one cell, not two - and splitting first
 * gets that wrong in a way that only shows up on the one row that needed it.
 */
export function parseCsv(text) {
  // The BOM is invisible and would otherwise become part of the first header
  // cell, so `Category` stops matching and every row looks malformed.
  const input = String(text ?? '').replace(/^﻿/, '');

  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];

    if (quoted) {
      if (char === '"') {
        // A doubled quote inside a quoted cell is one literal quote.
        if (input[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(cell);
      cell = '';
    } else if (char === '\n' || char === '\r') {
      // CRLF is two characters and must not end two rows.
      if (char === '\r' && input[i + 1] === '\n') i += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += char;
    }
  }

  // Whatever is left when the text runs out is the last cell of the last row,
  // unless the file ended on a newline and both are empty.
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  // A row of nothing but empty cells is a blank line, which a hand-made file
  // collects at the end and between sections.
  return rows
    .map((cells) => cells.map((value) => value.trim()))
    .filter((cells) => cells.some((value) => value !== ''));
}

/**
 * Rows, with the header dropped when there is one.
 *
 * **The header is optional**, and detected rather than required: a staff member
 * pasting three rows out of a spreadsheet does not paste the header, and one
 * exporting a file gets it. Detection is "does the first row's first cell match
 * the first expected column, case-insensitively" - narrow on purpose, because
 * guessing harder is how a real data row gets eaten as a header.
 */
export function rowsWithoutHeader(rows, firstColumnName) {
  if (!rows.length) return rows;

  const first = String(rows[0][0] ?? '').trim().toLowerCase();
  if (first === String(firstColumnName).trim().toLowerCase()) return rows.slice(1);

  return rows;
}

export default { parseCsv, rowsWithoutHeader };
