import { useState } from 'react';
import { useNavigate } from 'react-router';
import { ArrowLeft, CheckCircle2, FileSpreadsheet, Upload } from 'lucide-react';

import cn from '@/lib/cn';
import { pressable } from '@/lib/motion';
import Panel from '@/components/ui/Panel';
import Textarea from '@/components/ui/Textarea';
import Button from '@/components/ui/Button';
import Badge from '@/components/ui/Badge';
import PageHeader from '@/components/admin/PageHeader';
import { ADMIN_ROUTES } from '@/lib/adminRoutes';
import { adminIcon } from '@/components/admin/shell/adminIcons';
import { useAdminMutations } from '@/hooks/useAdmin';

/**
 * Bulk-add device models from CSV.
 *
 * ## Two ways in, one payload
 *
 * A file chooser and a paste box, because both are real: a shop with a
 * spreadsheet picks the file, and somebody adding four phones pastes four
 * lines. The file is read in the browser and posted as text either way - this
 * codebase has no upload middleware, and a CSV of device models is a few tens
 * of kilobytes.
 *
 * ## The result is a report, not a toast
 *
 * A hundred-row import that says "done" tells a staff member nothing about the
 * three rows it could not take. Every row comes back added, updated or skipped
 * with the reason, and skipped rows are listed first - they are the only ones
 * anybody has to act on.
 */
const ROUTE = ADMIN_ROUTES['/admin/settings/taxonomy/import'];
const ADMIN_PAGE = { ...ROUTE, icon: adminIcon(ROUTE.icon) };

/** The limit `express.json` actually enforces, stated in the unit a person reads. */
const MAX_BYTES = 900_000;

export function AdminTaxonomyImportPage() {
  const navigate = useNavigate();
  const { importTaxonomyCsv } = useAdminMutations();

  const [text, setText] = useState('');
  const [fileName, setFileName] = useState(null);
  const [error, setError] = useState(null);
  const [report, setReport] = useState(null);

  const back = () => navigate('/admin/settings/taxonomy');

  async function pickFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    setError(null);
    setReport(null);

    if (file.size > MAX_BYTES) {
      setError(`${file.name} is larger than 900 KB. Split it and import in batches.`);
      return;
    }

    setFileName(file.name);
    setText(await file.text());
  }

  async function submit(event) {
    event.preventDefault();
    setError(null);
    setReport(null);

    try {
      setReport(await importTaxonomyCsv.mutateAsync({ text }));
    } catch (err) {
      setError(err.message);
    }
  }

  // Skipped first: they are the only rows that need a decision. Within each
  // group the file's own order is kept, so a row number still finds the line.
  const rows = report
    ? [...report.rows].sort((a, b) => Number(b.status === 'skipped') - Number(a.status === 'skipped'))
    : [];

  return (
    <div className="form-page">
      <button
        type="button"
        onClick={back}
        className={cn(pressable, 'mb-4 inline-flex items-center gap-1.5 text-sm font-semibold text-ink-500 hover:text-ink-900')}
      >
        <ArrowLeft className="size-3.5" strokeWidth={2.25} aria-hidden="true" />
        Back to Device &amp; Models
      </button>

      <PageHeader
        icon={ADMIN_PAGE.icon}
        title="Import device models"
        description="Bulk-add or update the device master list."
      />

      <form onSubmit={submit} className="space-y-4">
        <Panel title="CSV format" icon={FileSpreadsheet}>
          <div className="space-y-2.5 text-sm leading-relaxed text-ink-600">
            <p>
              One row per model, in this order. The header row is optional.
            </p>
            <code className="block rounded-md bg-surface-2 px-3 py-2 font-mono text-xs text-ink-700">
              Category, Brand, Device, Model, Aliases
            </code>
            <p>
              Follows the tree <em>Category › Brand › Device › Model</em> - e.g.{' '}
              <code className="font-mono text-xs">Phone › Samsung › S-Series › Galaxy S24 Ultra</code>.
            </p>
            <ul className="ml-4 list-disc space-y-1">
              <li>
                <strong className="font-semibold text-ink-900">Category, Brand and Model</strong> are
                required; Device and Aliases are not.
              </li>
              <li>
                Separate multiple aliases with a vertical bar:{' '}
                <code className="font-mono text-xs">S24U|S24 Ultra</code> - a comma would read as the
                next column.
              </li>
              <li>Re-importing a row updates the existing entry, matched by its canonical slug.</li>
            </ul>
          </div>
        </Panel>

        <Panel
          title="The file"
          description="Choose a .csv, or paste the rows straight in."
          icon={Upload}
        >
          <label className="mb-4 block">
            <span className="mb-1.5 block text-sm font-medium text-ink-700">Upload a CSV</span>
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={pickFile}
              className="block w-full text-sm text-ink-600 file:mr-3 file:rounded-md file:border file:border-line-strong file:bg-surface file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-ink-700 hover:file:border-ink-300"
            />
            <span className="mt-1.5 block text-sm text-ink-400">
              Up to 900 KB. Larger lists import in batches.
            </span>
          </label>

          <Textarea
            label="Or paste the rows"
            rows={8}
            value={text}
            onChange={(event) => {
              setText(event.target.value);
              // The box is the payload once it is edited, so a filename left
              // over from a previous pick would be naming content that is no
              // longer in it.
              setFileName(null);
              setReport(null);
            }}
            placeholder={
              'Category,Brand,Device,Model,Aliases\nPhone,Apple,iPhone 15,iPhone 15 Pro Max,15 PM|15 Pro Max\nPhone,Samsung,S-Series,Galaxy S24 Ultra,S24U|S24 Ultra'
            }
            hint={fileName ? `Loaded from ${fileName}. Edit here before importing if you need to.` : undefined}
          />
        </Panel>

        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}

        {report && (
          <Panel title="Import result" icon={CheckCircle2}>
            <div className="mb-4 flex flex-wrap gap-2">
              <Badge tone="ok">{report.added} added</Badge>
              <Badge tone="info">{report.updated} updated</Badge>
              <Badge tone={report.skipped > 0 ? 'warn' : 'neutral'}>{report.skipped} skipped</Badge>
            </div>

            <ul className="divide-y divide-line">
              {rows.map((row) => (
                <li key={`${row.row}-${row.name}`} className="flex flex-wrap items-baseline gap-x-2 gap-y-1 py-2 first:pt-0">
                  <span className="font-mono text-xs text-ink-400">Row {row.row}</span>
                  <span className="font-medium text-ink-900">{row.name}</span>
                  <Badge
                    size="sm"
                    tone={row.status === 'skipped' ? 'warn' : row.status === 'updated' ? 'info' : 'ok'}
                  >
                    {row.status}
                  </Badge>
                  {row.reason && (
                    <span className="w-full text-sm leading-relaxed text-ink-500">{row.reason}</span>
                  )}
                </li>
              ))}
            </ul>

            <div className="mt-4 border-t border-line pt-4">
              <Button type="button" variant="outline" onClick={back}>
                Back to Device &amp; Models
              </Button>
            </div>
          </Panel>
        )}

        {!report && (
          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="submit"
              icon={Upload}
              loading={importTaxonomyCsv.isPending}
              disabled={!text.trim()}
            >
              Import
            </Button>
            <Button type="button" variant="outline" onClick={back}>
              Cancel
            </Button>
          </div>
        )}
      </form>
    </div>
  );
}

export default AdminTaxonomyImportPage;
