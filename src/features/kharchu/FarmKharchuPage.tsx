import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChatCircle } from '@phosphor-icons/react';
import { Temporal } from '@js-temporal/polyfill';
import { PageLayout } from '../../components/PageLayout';
import { StatusMessage } from '../../components/StatusMessage';
import { formatPaise } from '../../lib/money';
import { supabase } from '../../lib/supabase';
import { useMyProfile } from '../shared/useMyProfile';

type PeriodKey = 'this_month' | 'last_month' | 'this_year' | 'all';
const PERIODS: Array<{ key: PeriodKey; label: string }> = [
  { key: 'this_month', label: 'This month' },
  { key: 'last_month', label: 'Last month' },
  { key: 'this_year', label: 'This year' },
  { key: 'all', label: 'All time' },
];

interface Report {
  cash_in_paise: number; cash_out_paise: number; income_paise: number; operating_expense_paise: number; handover_purchases_paise: number;
  personal_payments_paise: number; interest_paise: number; loans_received_paise: number; principal_repaid_paise: number;
  handovers_given_paise: number; cash_returned_paise: number; uncertain_period: { count: number; paise: number };
  by_category: Array<{ name: string; paise: number }>;
  by_party: Array<{ name: string; paid_out_paise: number; received_paise: number }>;
  open_handovers: Array<{ id: string; description: string; party: string | null; date: string | null; amount_paise: number; allocated_paise: number; returned_paise: number; remaining_paise: number; status: string }>;
  planned: Array<{ id: string; description: string; party: string | null; due_on: string | null; amount_paise: number; status: string }>;
}

interface Entry {
  id: string; nature: string; direction: 'in' | 'out'; status: string; amount_paise: number; description_en: string;
  occurred_on_start: string | null; occurred_on_end: string | null; date_precision: string;
  ledger_parties?: { name?: string } | null; ledger_categories?: { name?: string } | null;
}

const NATURE_LABEL: Record<string, string> = {
  income: 'Income', operating_expense: 'Expense', personal_payment: 'Personal payment', loan_received: 'Loan received',
  loan_principal_repayment: 'Loan repaid', interest_payment: 'Interest', cash_handover: 'Cash given', cash_returned: 'Cash returned', transfer_adjustment: 'Adjustment',
};

function periodRange(key: PeriodKey, timeZone: string): { from: string | null; to: string | null } {
  if (key === 'all') return { from: null, to: null };
  const today = Temporal.Now.zonedDateTimeISO(timeZone).toPlainDate();
  if (key === 'this_year') return { from: `${today.year}-01-01`, to: `${today.year + 1}-01-01` };
  const month = today.toPlainYearMonth().subtract({ months: key === 'last_month' ? 1 : 0 });
  return { from: month.toPlainDate({ day: 1 }).toString(), to: month.add({ months: 1 }).toPlainDate({ day: 1 }).toString() };
}

function formatDay(value: string | null): string {
  if (!value) return 'Date unknown';
  const [year, month, day] = value.split('-').map(Number);
  return new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(year, month - 1, day)));
}

function entryDate(entry: Entry): string {
  if (entry.date_precision === 'approximate' && entry.occurred_on_start && entry.occurred_on_end) return `About ${formatDay(entry.occurred_on_start)}–${formatDay(entry.occurred_on_end)}`;
  return formatDay(entry.occurred_on_start);
}

export function FarmKharchuPage() {
  const { profile } = useMyProfile();
  const timeZone = profile?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  const [period, setPeriod] = useState<PeriodKey>('this_month');
  const [report, setReport] = useState<Report | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(Boolean(supabase));
  const [failed, setFailed] = useState(false);
  const range = useMemo(() => periodRange(period, timeZone), [period, timeZone]);

  useEffect(() => {
    if (!supabase) { setLoading(false); return; }
    let active = true;
    setLoading(true);
    let query = supabase.from('ledger_entries')
      .select('id,nature,direction,status,amount_paise,description_en,occurred_on_start,occurred_on_end,date_precision,ledger_parties(name),ledger_categories(name)')
      .is('voided_at', null).eq('status', 'actual').order('occurred_on_start', { ascending: false, nullsFirst: false }).order('recorded_at', { ascending: false }).limit(80);
    if (range.from) query = query.gte('occurred_on_start', range.from);
    if (range.to) query = query.lt('occurred_on_start', range.to);
    void Promise.all([supabase.rpc('get_gurtu_ledger_report', { p_from: range.from, p_to: range.to, p_party_id: null }), query]).then(([reportResult, entryResult]) => {
      if (!active) return;
      setFailed(Boolean(reportResult.error || entryResult.error));
      setReport(reportResult.error ? null : reportResult.data as Report);
      setEntries(entryResult.error ? [] : (entryResult.data ?? []) as unknown as Entry[]);
      setLoading(false);
    });
    return () => { active = false; };
  }, [range]);

  const net = report ? Number(report.cash_in_paise) - Number(report.cash_out_paise) : 0;
  const largestCategory = Math.max(1, ...(report?.by_category ?? []).map((item) => Number(item.paise)));

  return (
    <PageLayout title="Farm Kharchu" backTo="/" headerAction={<Link className="quiet-link talk-new-chat" to="/talk"><ChatCircle aria-hidden="true" /> Record in chat</Link>}>
      <section className="page-section kharchu">
        <p className="section-lead">Tell Gurtu what was paid, received, handed over or returned, in Telugu or English. Totals are calculated exactly from what was recorded.</p>
        <div className="kharchu-periods" role="group" aria-label="Period">
          {PERIODS.map((item) => <button key={item.key} type="button" className={`kharchu-period${period === item.key ? ' is-selected' : ''}`} aria-pressed={period === item.key} onClick={() => setPeriod(item.key)}>{item.label}</button>)}
        </div>
        {loading ? <p className="muted-copy">Loading Farm Kharchu…</p> : null}
        {failed ? <StatusMessage tone="error">We could not load Farm Kharchu. Please try again.</StatusMessage> : null}
        {report && !loading ? <>
          <div className="kharchu-totals">
            <div><span>Money in</span><strong>{formatPaise(Number(report.cash_in_paise))}</strong></div>
            <div><span>Money out</span><strong>{formatPaise(Number(report.cash_out_paise))}</strong></div>
            <div><span>Net cash</span><strong>{formatPaise(net)}</strong></div>
          </div>
          <p className="kharchu-note">Cash flow, not profit. Loans are shown separately from income, and loan repayments separately from expenses. Planned payments and estimates are not counted.</p>
          <dl className="kharchu-breakdown">
            <div><dt>Sales and income</dt><dd>{formatPaise(Number(report.income_paise))}</dd></div>
            <div><dt>Farm and household expenses</dt><dd>{formatPaise(Number(report.operating_expense_paise))}</dd></div>
            <div><dt>Bought with cash handed over</dt><dd>{formatPaise(Number(report.handover_purchases_paise))}</dd></div>
            <div><dt>Personal payments</dt><dd>{formatPaise(Number(report.personal_payments_paise))}</dd></div>
            <div><dt>Interest paid</dt><dd>{formatPaise(Number(report.interest_paise))}</dd></div>
            <div><dt>Loans received</dt><dd>{formatPaise(Number(report.loans_received_paise))}</dd></div>
            <div><dt>Loan principal repaid</dt><dd>{formatPaise(Number(report.principal_repaid_paise))}</dd></div>
            <div><dt>Cash handed over</dt><dd>{formatPaise(Number(report.handovers_given_paise))}</dd></div>
            <div><dt>Cash returned</dt><dd>{formatPaise(Number(report.cash_returned_paise))}</dd></div>
          </dl>
          {report.uncertain_period.count ? <StatusMessage tone="neutral">{report.uncertain_period.count} {report.uncertain_period.count === 1 ? 'entry' : 'entries'} ({formatPaise(Number(report.uncertain_period.paise))}) with approximate dates may belong to this period and are not included.</StatusMessage> : null}

          <h3 className="kharchu-heading">Still to settle</h3>
          {!report.open_handovers.length && !report.planned.length ? <p className="muted-copy">Nothing outstanding.</p> : null}
          <ul className="kharchu-list">
            {report.open_handovers.map((item) => <li key={item.id}><div><strong>{item.party ?? item.description}</strong><span>Given {formatPaise(Number(item.amount_paise))} on {formatDay(item.date)}; {formatPaise(Number(item.allocated_paise) + Number(item.returned_paise))} accounted for. The rest is not yet accounted for.</span></div><b>{formatPaise(Number(item.remaining_paise))}</b></li>)}
            {report.planned.map((item) => <li key={item.id}><div><strong>{item.description}</strong><span>{item.party ? `${item.party} · ` : ''}{item.status === 'estimate' ? 'Estimate' : item.due_on ? `Due ${formatDay(item.due_on)}` : 'Due, no date'}</span></div><b>{formatPaise(Number(item.amount_paise))}</b></li>)}
          </ul>

          {report.by_category.length ? <>
            <h3 className="kharchu-heading">Spending by category</h3>
            <ul className="kharchu-bars">
              {report.by_category.map((item) => <li key={item.name}><span>{item.name}</span><i style={{ width: `${Math.max(4, Math.round((Number(item.paise) / largestCategory) * 100))}%` }} aria-hidden="true" /><b>{formatPaise(Number(item.paise))}</b></li>)}
            </ul>
          </> : null}

          {report.by_party.length ? <>
            <h3 className="kharchu-heading">By person</h3>
            <ul className="kharchu-list">
              {report.by_party.map((item) => <li key={item.name}><div><strong>{item.name}</strong>{Number(item.received_paise) ? <span>received from: {formatPaise(Number(item.received_paise))}</span> : null}</div><b>paid {formatPaise(Number(item.paid_out_paise))}</b></li>)}
            </ul>
          </> : null}

          <h3 className="kharchu-heading">Entries</h3>
          {!entries.length ? <p className="muted-copy">No money recorded for this period yet.</p> : null}
          <ul className="kharchu-entries">
            {entries.map((entry) => <li key={entry.id}>
              <div><strong>{entry.description_en}</strong><span>{entryDate(entry)} · {NATURE_LABEL[entry.nature] ?? entry.nature}{entry.ledger_parties?.name ? ` · ${entry.ledger_parties.name}` : ''}{entry.ledger_categories?.name ? ` · ${entry.ledger_categories.name}` : ''}</span></div>
              <b>{entry.direction === 'in' ? '+' : '−'}{formatPaise(Number(entry.amount_paise))}</b>
            </li>)}
          </ul>
        </> : null}
      </section>
    </PageLayout>
  );
}
