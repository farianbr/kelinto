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
import { adminIcon } from '@/components/admin/shell/adminIcons';
import { SERVICE_CATEGORIES } from '@shared/schemas/admin';
import { useAdminMutations } from '@/hooks/useAdmin';

/**
 * Bulk-add repair services from CSV.
 *
 * The device-model importer's twin, deliberately: a shop that arrives with its
 * price list in a spreadsheet should not retype forty rows into a modal, and
 * the two screens answer the same question so they work the same way. See
 * `AdminTaxonomyImportPage` for why the payload is posted as text and why the
 * result is a per-row report rather than a toast.
 *
 * **Only the name is required.** A file carrying names and nothing else is a
 * real thing a shop sends - the prices come later, off the screen - so an
 * absent price column leaves the stored value alone rather than writing zero
 * over it and making every service free.
 */
const ADMIN_PAGE = { icon: adminIcon('Wrench') };

/** The limit `express.json` actually enforces, stated in the unit a person reads. */
const MAX_BYTES = 900_000;

export function AdminServiceImportPage() {
  const navigate = useNavigate();
  const { importServices } = useAdminMutations();

  const [text, setText] = useState('');
  const [fileName, setFileName] = useState(null);
  const [error, setError] = useState(null);
  const [report, setReport] = useState(null);

  const back = () => navigate('/admin/services');

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
      setReport(await importServices.mutateAsync({ text }));
    } catch (err) {
      setError(err.message);
    }
  }

  // Skipped first: they are the only rows that need a decision.
  const rows = report
    ? [...report.rows].sort(
        (a, b) => Number(b.status === 'skipped') - Number(a.status === 'skipped'),
      )
    : [];

  return (
    <div className="form-page">
      <button
        type="button"
        onClick={back}
        className={cn(
          pressable,
          'mb-4 inline-flex items-center gap-1.5 text-sm font-semibold text-ink-500 hover:text-ink-900',
        )}
      >
        <ArrowLeft className="size-3.5" strokeWidth={2.25} aria-hidden="true" />
        Back to Services
      </button>

      <PageHeader
        icon={ADMIN_PAGE.icon}
        title="Import services"
        description="Bulk-add or update the repair price list."
      />

      <form onSubmit={submit} className="space-y-4">
        <Panel title="CSV format" icon={FileSpreadsheet}>
          <div className="space-y-2.5 text-sm leading-relaxed text-ink-600">
            <p>One row per service, in this order. The header row is optional.</p>
            <code className="block rounded-md bg-surface-2 px-3 py-2 font-mono text-xs text-ink-700">
              Name, Category, Price, Duration (minutes), Warranty (days)
            </code>
            <ul className="ml-4 list-disc space-y-1">
              <li>
                <strong className="font-semibold text-ink-900">Name</strong> is the only required
                column. Leave any of the others blank and the stored value is kept.
              </li>
              <li>
                Category is one of{' '}
                <code className="font-mono text-xs">{SERVICE_CATEGORIES.join(', ')}</code>. Anything
                else is filed under <code className="font-mono text-xs">other</code>.
              </li>
              <li>
                Price is in dollars and may carry a currency symbol:{' '}
                <code className="font-mono text-xs">$129.99</code> and{' '}
                <code className="font-mono text-xs">129.99</code> both work.
              </li>
              <li>
                Re-importing a row updates the service with that name rather than adding a second
                one, so an edited export is the normal way to put prices up.
              </li>
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
              setFileName(null);
              setReport(null);
            }}
            placeholder={
              'Name,Category,Price,Duration (minutes),Warranty (days)\nScreen replacement - iPhone 15,screen,289.00,60,90\nBattery replacement - Galaxy S24,battery,129.00,45,180'
            }
            hint={
              fileName
                ? `Loaded from ${fileName}. Edit here before importing if you need to.`
                : undefined
            }
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
                <li
                  key={`${row.row}-${row.name}`}
                  className="flex flex-wrap items-baseline gap-x-2 gap-y-1 py-2 first:pt-0"
                >
                  <span className="font-mono text-xs text-ink-400">Row {row.row}</span>
                  <span className="font-medium text-ink-900">{row.name || '(no name)'}</span>
                  <Badge
                    size="sm"
                    tone={
                      row.status === 'skipped' ? 'warn' : row.status === 'updated' ? 'info' : 'ok'
                    }
                  >
                    {row.status}
                  </Badge>
                  {row.error && (
                    <span className="w-full text-sm leading-relaxed text-ink-500">{row.error}</span>
                  )}
                </li>
              ))}
            </ul>

            <div className="mt-4 border-t border-line pt-4">
              <Button type="button" variant="outline" onClick={back}>
                Back to Services
              </Button>
            </div>
          </Panel>
        )}

        {!report && (
          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="submit"
              icon={Upload}
              loading={importServices.isPending}
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

export default AdminServiceImportPage;
