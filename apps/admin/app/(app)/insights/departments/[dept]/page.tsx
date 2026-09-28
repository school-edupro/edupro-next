import {
  Badge,
  Breadcrumbs,
  Button,
  Card,
  DataTable,
  InputField,
  PageHeader,
  SelectField,
} from '@edupro/ui';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Notice } from '@/components/Notice';
import { requestDepartmentExport } from '@/lib/actions';
import { apiFetch, getMe } from '@/lib/api';
import type {
  ClassRow,
  Department,
  DepartmentDashboard,
  DepartmentReport,
  Page,
} from '@/lib/types';

const DEPARTMENTS: Department[] = [
  'academics',
  'attendance',
  'fees',
  'admissions',
  'transport',
  'communication',
  'hr',
];
type Row = Record<string, unknown>;
type Tr = (key: string, values?: Record<string, string | number>) => string;

const Kpi = ({ label, value, sub }: { label: string; value: string; sub?: string }) => (
  <Card elevated>
    <div className="ep-kicker">{label}</div>
    <div style={{ fontFamily: 'var(--font-heading)', fontSize: 'var(--fs-h2)', fontWeight: 600 }}>
      {value}
    </div>
    {sub ? <div className="ep-field__help">{sub}</div> : null}
  </Card>
);
const grid = (min: number) => ({
  display: 'grid',
  gap: 'var(--sp-3)',
  gridTemplateColumns: `repeat(auto-fit, minmax(${min}px, 1fr))`,
  marginBottom: 'var(--sp-4)',
});
const s = (v: unknown) => (v === null || v === undefined ? '—' : String(v));
const rupee = (v: unknown) => (v === null || v === undefined ? '—' : `₹${v}`);
const pctOf = (v: unknown) => (v === null || v === undefined ? '—' : `${v}%`);

/** A small table from rows of plain values; the columns name the keys and their labels. */
function Table({
  title,
  rows,
  columns,
  rowKey,
}: {
  title: string;
  rows: Row[];
  columns: Array<[string, string, ((r: Row) => React.ReactNode)?]>;
  rowKey?: (r: Row) => string;
}) {
  return (
    <Card title={title}>
      <DataTable<Row>
        caption={title}
        density="dense"
        columns={columns.map(([key, header, render]) => ({
          key,
          header,
          numeric: typeof rows[0]?.[key] === 'number',
          render: render ?? ((r: Row) => s(r[key])),
        }))}
        rows={rows}
        rowKey={rowKey ?? ((r) => String(r.id ?? r.date ?? r.code ?? JSON.stringify(r)))}
        emptyTitle="—"
      />
    </Card>
  );
}

function Academics({ d, i }: { d: Row; i: Tr }) {
  const lag = d.approvalLag as Row;
  return (
    <>
      <div style={grid(160)}>
        {(d.work14d as Row[]).map((w) => (
          <Kpi key={String(w.kind)} label={`${i('d.work14d')} · ${w.kind}`} value={s(w.n)} />
        ))}
        <Kpi label={i('d.sectionsWithoutHomework')} value={s(d.sectionsWithoutHomework7d)} />
        <Kpi
          label={i('d.approvalLag')}
          value={s(lag.avgHours)}
          sub={`${i('d.pendingPlans')}: ${s(lag.pending)} · ${i('d.oldestHours')}: ${s(lag.oldestHours)}`}
        />
      </div>
      <div style={grid(380)}>
        <Table
          title={i('d.coverage')}
          rows={d.coverage as Row[]}
          columns={[
            ['classCode', i('classFilter')],
            ['section', i('d.bySection')],
            ['homework7d', i('d.homework7d')],
            ['subjects7d', i('d.subjects7d')],
            ['lastOn', i('d.lastOn')],
          ]}
          rowKey={(r) => `${r.classCode}-${r.section}`}
        />
        <Table
          title={i('d.lessonPlans')}
          rows={d.lessonPlans as Row[]}
          columns={[
            ['status', i('d.status')],
            ['n', i('d.count')],
          ]}
          rowKey={(r) => String(r.status)}
        />
        <Table
          title={i('d.substitutions30d')}
          rows={d.substitutions30d as Row[]}
          columns={[
            ['date', i('from')],
            ['count', i('d.count')],
          ]}
        />
        <Table
          title={i('d.mostSubstituted')}
          rows={d.mostSubstituted as Row[]}
          columns={[
            ['name', i('d.type')],
            ['n', i('d.count')],
          ]}
          rowKey={(r) => String(r.name)}
        />
      </div>
    </>
  );
}

function Attendance({ d, i }: { d: Row; i: Tr }) {
  const today = d.today as Row;
  return (
    <>
      <div style={grid(150)}>
        <Kpi
          label={i('d.pct')}
          value={pctOf(today.pct)}
          sub={`${s(today.present)} / ${s(today.strength)}`}
        />
        <Kpi label={i('d.present')} value={s(today.present)} />
        <Kpi label={i('d.absent')} value={s(today.absent)} />
        <Kpi label={i('d.late')} value={s(today.late)} />
        <Kpi label={i('d.sectionsMarked')} value={`${s(today.marked)} / ${s(today.sections)}`} />
      </div>
      <div style={grid(380)}>
        <Table
          title={i('d.bySection')}
          rows={d.bySection as Row[]}
          columns={[
            ['classCode', i('classFilter')],
            ['section', i('d.bySection')],
            ['strength', i('d.students')],
            ['present', i('d.present')],
            ['pct', i('d.pct'), (r) => pctOf(r.pct)],
          ]}
          rowKey={(r) => `${r.classCode}-${r.section}`}
        />
        <Table
          title={i('d.trend30d')}
          rows={d.trend30d as Row[]}
          columns={[
            ['date', i('from')],
            ['present', i('d.present')],
            ['strength', i('d.students')],
            ['pct', i('d.pct'), (r) => pctOf(r.pct)],
          ]}
        />
        <Table
          title={i('d.chronic')}
          rows={d.chronicAbsentees30d as Row[]}
          columns={[
            [
              'name',
              i('d.students'),
              (r) => <a href={`/people/students/${r.studentId}`}>{s(r.name)}</a>,
            ],
            ['admissionNo', '#'],
            ['section', i('d.bySection')],
            ['absences', i('d.absences')],
            ['days', i('d.days')],
          ]}
          rowKey={(r) => String(r.studentId)}
        />
        <Table
          title={i('d.readers')}
          rows={d.readers as Row[]}
          columns={[
            ['code', i('d.readers')],
            ['name', i('d.type')],
            ['tapsToday', i('d.tapsToday')],
            ['silentHours', i('d.silentHours')],
            [
              'lastSeenAt',
              i('d.lastSeen'),
              (r) => (r.lastSeenAt ? new Date(String(r.lastSeenAt)).toLocaleString('en-IN') : '—'),
            ],
          ]}
          rowKey={(r) => String(r.code)}
        />
      </div>
    </>
  );
}

function Fees({ d, i }: { d: Row; i: Tr }) {
  const dues = d.dues as Row;
  const coll = d.collection as Row;
  const late = d.lateFee as Row;
  const setl = d.settlements as Row;
  return (
    <>
      <div style={grid(160)}>
        <Kpi
          label={i('d.dueTillDate')}
          value={rupee(dues.dueTillDate)}
          sub={`${i('d.students')}: ${s(dues.students)}`}
        />
        <Kpi
          label={i('d.collectedTillDate')}
          value={rupee(dues.collectedTillDate)}
          sub={pctOf(dues.pctCollected)}
        />
        <Kpi
          label={i('d.balance')}
          value={rupee(dues.balance)}
          sub={`${i('d.defaulters')}: ${s(dues.defaulters)}`}
        />
        <Kpi
          label={i('d.collectedToday')}
          value={rupee(coll.today)}
          sub={`${i('d.receiptsToday')}: ${s(coll.receiptsToday)}`}
        />
        <Kpi label={i('d.collected7d')} value={rupee(coll.d7)} />
        <Kpi
          label={i('d.collected30d')}
          value={rupee(coll.d30)}
          sub={`${i('d.previous30')}: ${rupee(coll.previous30)}`}
        />
        <Kpi
          label={i('d.lateFeePosted')}
          value={rupee(late.posted30d)}
          sub={`${i('d.overdueStudents')}: ${s(late.overdueStudents)}`}
        />
        <Kpi
          label={i('d.unsettledOnline')}
          value={rupee(setl.unsettledOnline)}
          sub={`${i('d.unmatchedLines')}: ${s(setl.unmatchedLines)} · ${i('d.mismatchedLines')}: ${s(setl.mismatchedLines)}`}
        />
      </div>
      <div style={grid(380)}>
        <Table
          title={i('d.ageing')}
          rows={d.ageing as Row[]}
          columns={[
            ['bucket', i('d.bucket')],
            ['balance', i('d.balance'), (r) => rupee(r.balance)],
            ['students', i('d.students')],
          ]}
          rowKey={(r) => String(r.bucket)}
        />
        <Table
          title={i('d.byMode')}
          rows={d.byMode30d as Row[]}
          columns={[
            ['mode', i('d.type')],
            ['amount', i('d.collectedTillDate'), (r) => rupee(r.amount)],
            ['receipts', i('d.receipts')],
          ]}
          rowKey={(r) => String(r.mode)}
        />
        <Table
          title={i('d.daily30d')}
          rows={d.daily30d as Row[]}
          columns={[
            ['date', i('from')],
            ['amount', i('d.collectedTillDate'), (r) => rupee(r.amount)],
          ]}
        />
        <Table
          title={i('d.refunds')}
          rows={d.refunds as Row[]}
          columns={[
            ['status', i('d.status')],
            ['count', i('d.count')],
            ['amount', i('d.balance'), (r) => rupee(r.amount)],
          ]}
          rowKey={(r) => String(r.status)}
        />
        <Table
          title={i('d.largestOverdue')}
          rows={d.defaulters as Row[]}
          columns={[
            [
              'name',
              i('d.students'),
              (r) => <a href={`/fees/ledger/${r.studentId}`}>{s(r.name)}</a>,
            ],
            ['admissionNo', '#'],
            ['section', i('d.bySection')],
            ['balance', i('d.balance'), (r) => rupee(r.balance)],
            ['daysOverdue', i('d.daysOverdue')],
          ]}
          rowKey={(r) => String(r.studentId)}
        />
        <Table
          title={i('d.byClass')}
          rows={d.byClass as Row[]}
          columns={[
            ['classCode', i('classFilter')],
            ['net', i('d.dueTillDate'), (r) => rupee(r.net)],
            ['paid', i('d.collectedTillDate'), (r) => rupee(r.paid)],
            ['balance', i('d.balance'), (r) => rupee(r.balance)],
            ['students', i('d.students')],
          ]}
          rowKey={(r) => String(r.classCode)}
        />
      </div>
    </>
  );
}

function Admissions({ d, i }: { d: Row; i: Tr }) {
  return (
    <>
      <div style={grid(380)}>
        {(d.cycles as Row[]).map((c) => (
          <Card
            key={String(c.cycleId)}
            title={`${s(c.code)} · ${s(c.status)} · ${i('d.total')} ${s(c.total)}`}
          >
            <DataTable<Row>
              caption={i('d.byStatus')}
              density="dense"
              columns={[
                { key: 'k', header: i('d.status'), render: (r) => s(r.k) },
                { key: 'v', header: i('d.count'), numeric: true, render: (r) => s(r.v) },
              ]}
              rows={Object.entries(c.byStatus as Record<string, number>).map(([k, v]) => ({
                k,
                v,
              }))}
              rowKey={(r) => String(r.k)}
              emptyTitle="—"
            />
          </Card>
        ))}
        <Table
          title={i('d.conversion')}
          rows={d.conversion as Row[]}
          columns={[
            ['cycle', i('d.cycles')],
            ['submitted', i('d.submitted')],
            ['selected', i('d.selected')],
            ['admitted', i('d.admitted')],
            ['avgDecisionDays', i('d.avgDecisionDays')],
          ]}
          rowKey={(r) => String(r.cycle)}
        />
        <Table
          title={i('d.seatFill')}
          rows={d.seatFill as Row[]}
          columns={[
            ['classCode', i('classFilter')],
            ['capacity', i('d.capacity')],
            ['enrolled', i('d.enrolled')],
            ['pct', i('d.seatFill'), (r) => pctOf(r.pct)],
          ]}
          rowKey={(r) => String(r.classCode)}
        />
      </div>
    </>
  );
}

function Transport({ d, i }: { d: Row; i: Tr }) {
  return (
    <>
      <div style={grid(160)}>
        {(d.requests as Row[]).map((r) => (
          <Kpi
            key={String(r.status)}
            label={`${i('d.requests')} · ${s(r.status)}`}
            value={s(r.count)}
          />
        ))}
      </div>
      <div style={grid(380)}>
        <Table
          title={i('d.routes')}
          rows={d.routes as Row[]}
          columns={[
            ['code', i('d.routes')],
            ['riders', i('d.riders')],
            ['capacity', i('d.capacity')],
            ['loadPct', i('d.load'), (r) => pctOf(r.loadPct)],
            ['boardedToday', i('d.boardedToday')],
            ['alightedToday', i('d.alightedToday')],
            ['lateBoarding7d', i('d.lateBoarding7d')],
          ]}
          rowKey={(r) => String(r.id)}
        />
        <Table
          title={i('d.expiring')}
          rows={d.expiring60d as Row[]}
          columns={[
            ['kind', i('d.type')],
            ['ref', i('d.routes')],
            ['what', i('d.what')],
            ['on', i('d.on')],
          ]}
          rowKey={(r) => `${r.kind}-${r.ref}-${r.what}-${r.on}`}
        />
        <Table
          title={i('d.logs30d')}
          rows={d.logs30d as Row[]}
          columns={[
            ['regNo', i('d.routes')],
            ['days', i('d.loggedDays')],
            ['km', i('d.km')],
            ['fuelLitres', i('d.fuel')],
            ['fuelCost', i('d.fuelCost'), (r) => rupee(r.fuelCost)],
            ['incidents', i('d.incidents')],
          ]}
          rowKey={(r) => String(r.regNo)}
        />
      </div>
    </>
  );
}

function Communication({ d, i }: { d: Row; i: Tr }) {
  const q = d.queries as Row;
  return (
    <>
      <div style={grid(160)}>
        <Kpi label={i('d.families')} value={s(d.families)} />
        <Kpi
          label={`${i('d.queries')} · ${i('d.openQueries')}`}
          value={s(q.open)}
          sub={`${i('d.closed30d')}: ${s(q.closed30d)}`}
        />
        <Kpi label={i('d.avgFirstResponse')} value={s(q.avgFirstResponseHours)} />
        <Kpi label={i('d.avgClose')} value={s(q.avgCloseDays)} />
        <Kpi label={i('d.rating')} value={s(q.rating)} />
      </div>
      <div style={grid(380)}>
        <Table
          title={i('d.delivery30d')}
          rows={d.delivery30d as Row[]}
          columns={[
            ['channel', i('d.channel')],
            ['status', i('d.status')],
            ['messages', i('d.messages')],
          ]}
          rowKey={(r) => `${r.channel}-${r.status}`}
        />
        <Table
          title={i('d.consents')}
          rows={d.consents as Row[]}
          columns={[
            ['purpose', i('d.purpose')],
            ['status', i('d.status')],
            ['n', i('d.count')],
          ]}
          rowKey={(r) => `${r.purpose}-${r.status}`}
        />
        <Table
          title={i('d.byCategory')}
          rows={d.queriesByCategory as Row[]}
          columns={[
            ['category', i('d.category')],
            ['open', i('d.openQueries')],
            ['total', i('d.total')],
          ]}
          rowKey={(r) => String(r.category)}
        />
      </div>
    </>
  );
}

function Hr({ d, i }: { d: Row; i: Tr }) {
  const p = d.punchesToday as Row;
  return (
    <>
      <div style={grid(160)}>
        <Kpi label={i('d.active')} value={s(d.active)} />
        <Kpi label={i('d.joined12m')} value={s(d.joined12m)} />
        <Kpi label={i('d.left12m')} value={s(d.left12m)} />
        <Kpi
          label={i('d.punchesToday')}
          value={s(p.present)}
          sub={`${pctOf(p.pct)} · ${i('d.firstIn')} ${s(p.firstIn)}`}
        />
      </div>
      <div style={grid(380)}>
        <Table
          title={i('d.headcount')}
          rows={d.headcount as Row[]}
          columns={[
            ['department', i('department')],
            ['type', i('d.type')],
            ['count', i('d.count')],
          ]}
          rowKey={(r) => `${r.department}-${r.type}`}
        />
        <Table
          title={i('d.designations')}
          rows={d.designations as Row[]}
          columns={[
            ['designation', i('d.type')],
            ['count', i('d.count')],
          ]}
          rowKey={(r) => String(r.designation)}
        />
        <Table
          title={i('d.punchTrend')}
          rows={d.punchTrend14d as Row[]}
          columns={[
            ['date', i('from')],
            ['present', i('d.present')],
          ]}
        />
      </div>
    </>
  );
}

/** Sprint 13 (AI track): a department's dashboard and report centre. */
export default async function DepartmentPage({
  params,
  searchParams,
}: {
  params: Promise<{ dept: string }>;
  searchParams: Promise<{
    ok?: string;
    error?: string;
    detail?: string;
    date?: string;
    classId?: string;
  }>;
}) {
  const { dept } = await params;
  if (!DEPARTMENTS.includes(dept as Department)) notFound();
  const sp = await searchParams;
  const q = new URLSearchParams();
  if (sp.date) q.set('date', sp.date);
  if (sp.classId) q.set('classId', sp.classId);
  const [t, i, me, dash, reports, classes] = await Promise.all([
    getTranslations('pages.insights_department'),
    getTranslations('insights'),
    getMe(),
    apiFetch<DepartmentDashboard>(`/insights/departments/${dept}?${q.toString()}`),
    apiFetch<{ data: DepartmentReport[] }>(`/insights/departments/${dept}/reports`).then(
      (r) => r.data,
    ),
    apiFetch<Page<ClassRow>>('/academics/classes?size=200')
      .then((r) => r.data)
      .catch(() => [] as ClassRow[]),
  ]);
  const canExport = me.permissions.includes('reports.export.create');
  const body = dash as unknown as Row;
  const name = i(`departmentNames.${dept}`);
  return (
    <>
      <Breadcrumbs
        items={[{ label: t('kicker'), href: '/insights/departments' }, { label: name }]}
      />
      <PageHeader
        kicker={t('kicker')}
        title={`${name} · ${dash.year.code}`}
        description={t('description')}
        actions={
          <form
            method="get"
            style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'flex-end' }}
          >
            <InputField
              id="date"
              name="date"
              label={i('date')}
              type="date"
              defaultValue={dash.date}
            />
            {dept === 'academics' || dept === 'attendance' || dept === 'fees' ? (
              <SelectField
                id="classId"
                name="classId"
                label={i('classFilter')}
                defaultValue={sp.classId ?? ''}
                options={[
                  { value: '', label: i('allClasses') },
                  ...classes.map((c) => ({ value: c.id, label: c.code })),
                ]}
              />
            ) : null}
            <Button type="submit" variant="secondary">
              {i('show')}
            </Button>
          </form>
        }
      />
      <Notice params={sp} />
      {dept === 'academics' ? <Academics d={body} i={i} /> : null}
      {dept === 'attendance' ? <Attendance d={body} i={i} /> : null}
      {dept === 'fees' ? <Fees d={body} i={i} /> : null}
      {dept === 'admissions' ? <Admissions d={body} i={i} /> : null}
      {dept === 'transport' ? <Transport d={body} i={i} /> : null}
      {dept === 'communication' ? <Communication d={body} i={i} /> : null}
      {dept === 'hr' ? <Hr d={body} i={i} /> : null}

      <Card title={i('reportCentre')}>
        <p className="ep-field__help">{i('exportQueued')}</p>
        <DataTable<DepartmentReport>
          caption={i('reportCentre')}
          density="dense"
          columns={[
            { key: 'title', header: i('dataset'), render: (r) => <strong>{r.title}</strong> },
            {
              key: 'columns',
              header: i('columns'),
              render: (r) => <small>{r.columns.join(', ')}</small>,
            },
            {
              key: 'export',
              header: '',
              render: (r) =>
                r.allowed && canExport ? (
                  <form
                    action={requestDepartmentExport}
                    style={{
                      display: 'flex',
                      gap: 'var(--sp-2)',
                      alignItems: 'flex-end',
                      flexWrap: 'wrap',
                    }}
                  >
                    <input type="hidden" name="department" value={dept} />
                    <input type="hidden" name="dataset" value={r.id} />
                    <input type="hidden" name="academicYearId" value={dash.year.id} />
                    <InputField id={`from-${r.id}`} name="from" label={i('from')} type="date" />
                    <InputField id={`to-${r.id}`} name="to" label={i('to')} type="date" />
                    <Button type="submit" name="format" value="csv" variant="secondary" size="sm">
                      {i('exportCsv')}
                    </Button>
                    <Button type="submit" name="format" value="xlsx" variant="secondary" size="sm">
                      {i('exportXlsx')}
                    </Button>
                  </form>
                ) : (
                  <Badge tone="neutral">{i('notAllowed')}</Badge>
                ),
            },
          ]}
          rows={reports}
          rowKey={(r) => r.id}
          emptyTitle="—"
        />
      </Card>
    </>
  );
}
