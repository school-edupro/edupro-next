import {
  Badge,
  Breadcrumbs,
  Button,
  Card,
  DataTable,
  FormActions,
  FormRow,
  FormSection,
  InputField,
  SelectField,
} from '@edupro/ui';
import { getTranslations } from 'next-intl/server';
import { ConfirmAction } from '@/components/ConfirmAction';
import { Notice } from '@/components/Notice';
import { Icon } from '@/components/nav-icons';
import { EmployeeHero, EMPLOYEE_TABS, type EmployeeTab } from '@/components/employees/EmployeeHero';
import { EmployeeOverview } from '@/components/employees/EmployeeOverview';
import { EmployeeProfileEditor } from '@/components/employees/EmployeeProfileEditor';
import { ChipPickerField } from '@/components/ChipPickerField';
import { FileLinks } from '@/components/FileLinks';
import { ExportWatcher } from '@/components/ExportWatcher';
import { upsertPosting } from '@/lib/actions';
import {
  moveEmployeeCampus,
  removeEmployeeDocument,
  requestEmployeeTransfer,
  removeEmployeeRow,
  saveEmployeeProfile,
  saveEmployeeRow,
  saveEmployeeSubjects,
  uploadEmployeeDocument,
  verifyEmployeeDocument,
} from '@/lib/employee-actions';
import { apiFetch, getMe } from '@/lib/api';
import { ACR_STATUS, type AcrRow } from '@/lib/acr';
import type { EmployeeCatalogue, EmployeeProfile } from '@/lib/employee';
import type { Employee, Employee360, Page, PersonDocument, Posting, School } from '@/lib/types';

type Tab = EmployeeTab;
const OK: Record<string, string> = {
  saved: 'Saved.',
  photo: 'The photo is updated: it shows on the profile printout and the ID card.',
  view_ended: 'The session as them has ended; you are yourself again.',
  removed: 'Removed.',
  login: 'The staff login is made: they sign in with a code sent to their mobile or email.',
  uploaded: 'The document is uploaded.',
  moved: 'Moved to the other campus: the posting, the transfer history and a remark are updated.',
  transfer: 'The transfer is sent: the other school accepts it (People → Staff transfers there).',
  transferred:
    'Transferred in: the profile, rows, documents and login are carried over. Fill what the remark lists.',
  verified: 'Marked as checked against the original.',
  unverified: 'The check is taken back.',
};
const dmy = (d: string | null) => (d ? d.split('-').reverse().join('-') : '—');
/** A master list as options, keeping a value from before the list existed (shown, not lost). */
const withCurrent = (values: string[], current: string | null | undefined) => [
  { value: '', label: 'Choose…' },
  ...(current && !values.includes(current)
    ? [{ value: current, label: `${current} (not in Staff setup)` }]
    : []),
  ...values.map((v) => ({ value: v, label: v })),
];

/**
 * The employee (docs/design/30-employee-master.md): the hero with photo and facts (0188), an overview,
 * the full profile by section, education, languages, work experience, transfers and remarks, and the
 * posting and documents; the staff login, the ID card and Open as….
 */
export default async function EmployeePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    tab?: string;
    ok?: string;
    error?: string;
    detail?: string;
    export?: string;
    /** 1: open the "Open an app as them" dialog at once (from the list's row menu, 0188) */
    openAs?: string;
  }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const tab: Tab = EMPLOYEE_TABS.some(([k]) => k === sp.tab) ? (sp.tab as Tab) : 'overview';
  const [t, p, c, me, employee, profile, catalogue, others, school] = await Promise.all([
    getTranslations('people.employees'),
    getTranslations('people'),
    getTranslations('common'),
    getMe(),
    apiFetch<Employee360>(`/people/employees/${id}`),
    apiFetch<EmployeeProfile>(`/people/staff/${id}/profile`),
    apiFetch<EmployeeCatalogue>('/people/staff/catalogue'),
    apiFetch<Page<Employee>>('/people/employees?size=200&status=active'),
    apiFetch<School>('/platform/school').catch(() => null),
  ]);
  const canEdit = me.permissions.includes('people.employee.edit');
  const canTransfer = me.permissions.includes('people.staff_transfer.manage');
  // the other schools of the group (a transfer's possible targets)
  const targets =
    canTransfer && tab === 'history'
      ? await apiFetch<{ data: Array<{ id: string; code: string; name: string }> }>(
          '/people/staff-transfers/targets',
        )
          .then((r) => r.data)
          .catch(() => [])
      : [];
  // the employee's ACRs, newest cycle first (for those who see ACRs)
  const canAcr = me.permissions.includes('people.acr.view');
  const acrs =
    tab === 'acr' && canAcr
      ? await apiFetch<{ data: AcrRow[] }>(`/people/acr/employee/${id}`)
          .then((r) => r.data)
          .catch(() => [])
      : [];
  const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
  const rows = profile.rows;
  const list = (code: string) => catalogue.lists[code] ?? [];
  const opts = (code: string) => [
    { value: '', label: 'Choose…' },
    ...list(code).map((v) => ({ value: v, label: v })),
  ];
  const hidden = (kind: string, rowId?: string) => (
    <>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="kind" value={kind} />
      {rowId ? <input type="hidden" name="rowId" value={rowId} /> : null}
    </>
  );
  const remove = (kind: string, rowId: string, what: string) =>
    canEdit ? (
      <ConfirmAction
        action={removeEmployeeRow}
        fields={{ id, kind, rowId }}
        label="Remove"
        title={`Remove ${what}?`}
        confirmLabel="Remove"
        variant="danger"
        confirmVariant="danger"
      >
        The row is removed from the profile.
      </ConfirmAction>
    ) : null;
  const addButton = (
    <button type="submit" className="ep-btn ep-btn--primary ep-btn--sm">
      <Icon name="plus" size={16} /> Add
    </button>
  );

  return (
    <>
      <Breadcrumbs
        items={[
          { label: p('kicker'), href: '/people/employees' },
          { label: t('title'), href: '/people/employees' },
          { label: employee.displayName },
        ]}
      />
      <EmployeeHero
        employee={employee}
        profile={profile}
        tab={tab}
        can={(perm) => me.permissions.includes(perm)}
        impersonating={Boolean(me.impersonation)}
        openAs={sp.openAs === '1'}
      />
      <Notice params={{ ...sp, detail: sp.ok ? (OK[sp.ok] ?? 'Done.') : sp.detail }} />
      {sp.export && /^\d{1,18}$/.test(sp.export) ? (
        <ExportWatcher
          id={sp.export}
          format="pdf"
          labels={{
            queued: 'Employee profile PDF requested',
            ready: 'Employee profile PDF',
            pending: 'Preparing the PDF… open it to print, or download it',
            failed: 'The PDF could not be made',
            stuck:
              'Still waiting after a minute: the workers service prepares files; check that it is running',
          }}
        />
      ) : null}
      {tab === 'overview' ? (
        <EmployeeOverview
          employee={employee}
          profile={profile}
          catalogue={catalogue}
          canAcr={canAcr}
        />
      ) : null}

      {tab === 'profile' ? (
        <>
          <Card title="Teaching subjects" style={{ marginBottom: 'var(--sp-4)' }}>
            {canEdit ? (
              <form
                action={saveEmployeeSubjects}
                style={{ display: 'grid', gap: 'var(--sp-3)', maxWidth: '48rem' }}
              >
                <input type="hidden" name="id" value={id} />
                <ChipPickerField
                  name="subjects"
                  label="Subjects this employee teaches"
                  options={catalogue.subjects.map((x) => ({ value: x.id, label: x.name }))}
                  initial={profile.subjects.map((x) => x.id)}
                  help="From Academics → Subjects. Leave empty for staff who do not teach."
                />
                <div>
                  <button type="submit" className="ep-btn ep-btn--secondary ep-btn--sm">
                    <Icon name="check" size={16} /> Save subjects
                  </button>
                </div>
              </form>
            ) : profile.subjects.length ? (
              <p style={{ margin: 0 }}>{profile.subjects.map((x) => x.name).join(', ')}</p>
            ) : (
              <p className="ep-field__help" style={{ margin: 0 }}>
                No teaching subject.
              </p>
            )}
          </Card>
          <EmployeeProfileEditor
            catalogue={catalogue}
            profile={profile}
            canEdit={canEdit}
            save={saveEmployeeProfile}
          />
        </>
      ) : null}

      {tab === 'documents' ? (
        <Card title="Documents for employment">
          <p className="ep-field__help" style={{ marginTop: 0 }}>
            {profile.documents.missing
              ? `${String(profile.documents.missing)} of ${String(profile.documents.required)} required documents missing or expired.`
              : `All ${String(profile.documents.required)} required documents are on file.`}
            {profile.documents.unverified
              ? ` ${String(profile.documents.unverified)} not yet checked against the original.`
              : ''}{' '}
            The list is kept in People → Staff setup → Employee document types.
          </p>
          <div className="ep-table-wrap">
            <table className="ep-table ep-table--dense">
              <caption className="ep-sr-only">Documents for employment</caption>
              <thead>
                <tr>
                  <th scope="col">Document</th>
                  <th scope="col">Status</th>
                  <th scope="col">On file</th>
                  {canEdit ? <th scope="col">Upload</th> : null}
                </tr>
              </thead>
              <tbody>
                {profile.documents.types.map((d) => (
                  <tr key={d.typeId}>
                    <td>
                      <strong>{d.name}</strong>
                      <span className="ep-field__help">
                        {d.required ? ' · required' : ' · optional'}
                      </span>
                    </td>
                    <td>
                      {d.done ? (
                        <Badge tone="success">On file</Badge>
                      ) : d.files.some((f) => f.expired) ? (
                        <Badge tone="danger">Expired</Badge>
                      ) : d.required ? (
                        <Badge tone="warning">Missing</Badge>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td>
                      {d.files.length ? (
                        <ul
                          style={{
                            listStyle: 'none',
                            margin: 0,
                            padding: 0,
                            display: 'grid',
                            gap: 'var(--sp-2)',
                          }}
                        >
                          {d.files.map((f) => (
                            <li
                              key={f.id}
                              style={{
                                display: 'flex',
                                gap: 'var(--sp-2)',
                                alignItems: 'center',
                                flexWrap: 'wrap',
                              }}
                            >
                              <FileLinks href={`/api/employee-docs/${id}/${f.id}`} label={d.name} />
                              {f.number ? <span>{f.number}</span> : null}
                              {f.expiresOn ? (
                                <span className="ep-field__help">
                                  valid till {dmy(f.expiresOn)}
                                </span>
                              ) : null}
                              {f.expired ? <Badge tone="danger">Expired</Badge> : null}
                              {f.verifiedAt ? (
                                <Badge tone="success">
                                  Checked{f.verifiedBy ? ` by ${f.verifiedBy}` : ''}
                                </Badge>
                              ) : (
                                <Badge tone="neutral">Not checked</Badge>
                              )}
                              {canEdit ? (
                                <form action={verifyEmployeeDocument}>
                                  <input type="hidden" name="id" value={id} />
                                  <input type="hidden" name="docId" value={f.id} />
                                  <input
                                    type="hidden"
                                    name="verified"
                                    value={f.verifiedAt ? 'no' : 'yes'}
                                  />
                                  <button type="submit" className="ep-btn ep-btn--ghost ep-btn--sm">
                                    <Icon name="check" size={16} />{' '}
                                    {f.verifiedAt ? 'Take the check back' : 'Mark checked'}
                                  </button>
                                </form>
                              ) : null}
                              {canEdit ? (
                                <ConfirmAction
                                  action={removeEmployeeDocument}
                                  fields={{ id, docId: f.id }}
                                  label="Remove"
                                  title={`Remove this ${d.name}?`}
                                  confirmLabel="Remove"
                                  variant="danger"
                                  confirmVariant="danger"
                                >
                                  The file is taken off the employee&apos;s documents.
                                </ConfirmAction>
                              ) : null}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        '—'
                      )}
                    </td>
                    {canEdit ? (
                      <td>
                        <details>
                          <summary className="ep-btn ep-btn--secondary ep-btn--sm">
                            <Icon name="plus" size={16} /> Upload
                          </summary>
                          <form
                            action={uploadEmployeeDocument}
                            style={{
                              display: 'grid',
                              gap: 'var(--sp-2)',
                              marginTop: 'var(--sp-2)',
                              minWidth: '16rem',
                            }}
                          >
                            <input type="hidden" name="id" value={id} />
                            <input type="hidden" name="typeId" value={d.typeId} />
                            <InputField
                              id={`dc-f-${d.typeId}`}
                              name="file"
                              label="File (PDF or image, up to 5 MB)"
                              type="file"
                              accept="application/pdf,image/png,image/jpeg,image/webp"
                              required
                            />
                            <InputField
                              id={`dc-n-${d.typeId}`}
                              name="number"
                              label="Number (if any)"
                              maxLength={60}
                            />
                            <InputField
                              id={`dc-i-${d.typeId}`}
                              name="issuedOn"
                              label="Issued on"
                              type="date"
                            />
                            {d.hasExpiry ? (
                              <InputField
                                id={`dc-e-${d.typeId}`}
                                name="expiresOn"
                                label="Valid till"
                                type="date"
                                required
                              />
                            ) : null}
                            <div>
                              <button type="submit" className="ep-btn ep-btn--primary ep-btn--sm">
                                Upload
                              </button>
                            </div>
                          </form>
                        </details>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}

      {tab === 'education' ? (
        <Card title="Education">
          {rows.education.length ? (
            <div className="ep-table-wrap">
              <table className="ep-table ep-table--dense">
                <caption className="ep-sr-only">Education</caption>
                <thead>
                  <tr>
                    <th scope="col">Qualification</th>
                    <th scope="col">Subject / specialisation</th>
                    <th scope="col">Board / university</th>
                    <th scope="col">Year</th>
                    <th scope="col">Marks / grade</th>
                    <th scope="col">Mode</th>
                    <th scope="col">
                      <span className="ep-sr-only">Remove</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.education.map((x) => (
                    <tr key={x.id}>
                      <th scope="row">{x.qualification}</th>
                      <td>{x.specialisation ?? '—'}</td>
                      <td>{x.institution ?? '—'}</td>
                      <td>{x.passingYear ?? '—'}</td>
                      <td>{x.score ?? '—'}</td>
                      <td>{x.mode ?? '—'}</td>
                      <td>{remove('education', x.id, x.qualification)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="ep-field__help">No qualification yet.</p>
          )}
          {canEdit ? (
            <form
              action={saveEmployeeRow}
              className="ep-filter-band"
              style={{ marginTop: 'var(--sp-4)', marginBottom: 0 }}
            >
              {hidden('education')}
              <SelectField
                id="ed-q"
                name="qualification"
                label="Qualification"
                options={opts('Qualification')}
                required
              />
              <InputField
                id="ed-s"
                name="specialisation"
                label="Subject / specialisation"
                maxLength={120}
              />
              <InputField id="ed-i" name="institution" label="Board / university" maxLength={200} />
              <InputField
                id="ed-y"
                name="passingYear"
                label="Year"
                inputMode="numeric"
                pattern="[0-9]{4}"
                maxLength={4}
              />
              <InputField id="ed-sc" name="score" label="Marks / grade" maxLength={20} />
              <SelectField id="ed-m" name="mode" label="Mode" options={opts('EducationMode')} />
              {addButton}
            </form>
          ) : null}
        </Card>
      ) : null}

      {tab === 'languages' ? (
        <Card title="Languages">
          {rows.languages.length ? (
            <div className="ep-table-wrap">
              <table className="ep-table ep-table--dense">
                <caption className="ep-sr-only">Languages</caption>
                <thead>
                  <tr>
                    <th scope="col">Language</th>
                    <th scope="col">Read</th>
                    <th scope="col">Write</th>
                    <th scope="col">Speak</th>
                    <th scope="col">
                      <span className="ep-sr-only">Remove</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.languages.map((x) => (
                    <tr key={x.id}>
                      <th scope="row">{x.language}</th>
                      <td>{x.canRead ? 'Yes' : 'No'}</td>
                      <td>{x.canWrite ? 'Yes' : 'No'}</td>
                      <td>{x.canSpeak ? 'Yes' : 'No'}</td>
                      <td>{remove('languages', x.id, x.language)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="ep-field__help">No language yet.</p>
          )}
          {canEdit ? (
            <form
              action={saveEmployeeRow}
              className="ep-filter-band"
              style={{ marginTop: 'var(--sp-4)', marginBottom: 0 }}
            >
              {hidden('languages')}
              <SelectField
                id="la-l"
                name="language"
                label="Language"
                options={opts('Language')}
                required
              />
              {(
                [
                  ['canRead', 'Read'],
                  ['canWrite', 'Write'],
                  ['canSpeak', 'Speak'],
                ] as const
              ).map(([k, label]) => (
                <label key={k} className="ep-check" style={{ alignSelf: 'center' }}>
                  <input type="checkbox" className="ep-check__input" name={k} defaultChecked />
                  <span className="ep-check__box" aria-hidden="true" />
                  <span className="ep-check__text">{label}</span>
                </label>
              ))}
              {addButton}
            </form>
          ) : null}
        </Card>
      ) : null}

      {tab === 'experience' ? (
        <Card title="Work experience before joining">
          {rows.experience.length ? (
            <div className="ep-table-wrap">
              <table className="ep-table ep-table--dense">
                <caption className="ep-sr-only">Work experience</caption>
                <thead>
                  <tr>
                    <th scope="col">Organisation</th>
                    <th scope="col">Designation</th>
                    <th scope="col">From</th>
                    <th scope="col">To</th>
                    <th scope="col">Reason for leaving</th>
                    <th scope="col">
                      <span className="ep-sr-only">Remove</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.experience.map((x) => (
                    <tr key={x.id}>
                      <th scope="row">{x.organisation}</th>
                      <td>{x.designation ?? '—'}</td>
                      <td>{dmy(x.fromOn)}</td>
                      <td>{dmy(x.toOn)}</td>
                      <td>{x.reason ?? '—'}</td>
                      <td>{remove('experience', x.id, x.organisation)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="ep-field__help">No earlier work yet.</p>
          )}
          {canEdit ? (
            <form
              action={saveEmployeeRow}
              className="ep-filter-band"
              style={{ marginTop: 'var(--sp-4)', marginBottom: 0 }}
            >
              {hidden('experience')}
              <InputField
                id="ex-o"
                name="organisation"
                label="Organisation"
                maxLength={200}
                required
              />
              <InputField id="ex-d" name="designation" label="Designation" maxLength={120} />
              <InputField id="ex-f" name="fromOn" label="From" type="date" />
              <InputField id="ex-t" name="toOn" label="To" type="date" />
              <InputField id="ex-r" name="reason" label="Reason for leaving" maxLength={300} />
              {addButton}
            </form>
          ) : null}
        </Card>
      ) : null}

      {tab === 'history' && canTransfer && employee.status === 'active' ? (
        <div className="ep-chart__grid2">
          <Card title="Move to another campus">
            <form action={moveEmployeeCampus} style={{ display: 'grid', gap: 'var(--sp-3)' }}>
              <input type="hidden" name="id" value={id} />
              <div className="ep-fit-row">
                <SelectField
                  id="mv-campus"
                  name="campusId"
                  label="To campus"
                  required
                  defaultValue=""
                  options={[
                    { value: '', label: 'Choose…' },
                    ...(school?.campuses ?? []).map((x) => ({ value: x.id, label: x.name })),
                  ]}
                />
                <InputField
                  id="mv-on"
                  name="onDate"
                  label="From"
                  type="date"
                  required
                  defaultValue={today}
                />
              </div>
              <div className="ep-fit-row">
                <SelectField
                  id="mv-dept"
                  name="department"
                  label="Department (if it changes)"
                  defaultValue=""
                  options={[
                    { value: '', label: 'No change' },
                    ...list('Department').map((v) => ({ value: v, label: v })),
                  ]}
                />
                <SelectField
                  id="mv-desg"
                  name="designation"
                  label="Designation (if it changes)"
                  defaultValue=""
                  options={[
                    { value: '', label: 'No change' },
                    ...list('Designation').map((v) => ({ value: v, label: v })),
                  ]}
                />
              </div>
              <div className="ep-fit-row">
                <InputField id="mv-order" name="orderNo" label="Order number" maxLength={60} />
                <InputField id="mv-rem" name="remarks" label="Remarks" maxLength={300} />
              </div>
              <div>
                <button type="submit" className="ep-btn ep-btn--primary ep-btn--sm">
                  <Icon name="send" size={16} /> Move
                </button>
              </div>
            </form>
          </Card>
          <Card title="Transfer to another school of the group">
            {targets.length ? (
              <form
                action={requestEmployeeTransfer}
                style={{ display: 'grid', gap: 'var(--sp-3)' }}
              >
                <input type="hidden" name="id" value={id} />
                <div className="ep-fit-row">
                  <SelectField
                    id="tr-school"
                    name="toSchoolId"
                    label="To school"
                    required
                    defaultValue=""
                    options={[
                      { value: '', label: 'Choose…' },
                      ...targets.map((x) => ({ value: x.id, label: x.name })),
                    ]}
                  />
                  <InputField
                    id="tr-date"
                    name="onDate"
                    label="From"
                    type="date"
                    required
                    defaultValue={today}
                  />
                </div>
                <div className="ep-fit-row">
                  <InputField id="tr-ord" name="orderNo" label="Order number" maxLength={60} />
                  <InputField
                    id="tr-note"
                    name="note"
                    label="Note to the other school"
                    maxLength={500}
                  />
                </div>
                <p className="ep-field__help" style={{ margin: 0 }}>
                  The other school accepts it and gives its own code, department and designation.
                  The profile, education, languages, experience, documents, subjects and the login
                  go with the employee; here the record closes on the date.
                </p>
                <div>
                  <button type="submit" className="ep-btn ep-btn--primary ep-btn--sm">
                    <Icon name="send" size={16} /> Send the transfer
                  </button>
                </div>
              </form>
            ) : (
              <p className="ep-field__help" style={{ margin: 0 }}>
                This school has no other school in its group.
              </p>
            )}
          </Card>
        </div>
      ) : null}

      {tab === 'history' ? (
        <div className="ep-chart__grid2">
          <Card title="Transfers">
            {rows.transfers.length ? (
              <div className="ep-table-wrap">
                <table className="ep-table ep-table--dense">
                  <caption className="ep-sr-only">Transfers</caption>
                  <thead>
                    <tr>
                      <th scope="col">On</th>
                      <th scope="col">From</th>
                      <th scope="col">To</th>
                      <th scope="col">Order</th>
                      <th scope="col">
                        <span className="ep-sr-only">Remove</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.transfers.map((x) => (
                      <tr key={x.id}>
                        <th scope="row">{dmy(x.onDate)}</th>
                        <td>{x.fromPlace ?? '—'}</td>
                        <td>
                          {x.toPlace}
                          {x.remarks ? <div className="ep-field__help">{x.remarks}</div> : null}
                        </td>
                        <td>{x.orderNo ?? '—'}</td>
                        <td>{remove('transfers', x.id, 'this transfer')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="ep-field__help">No transfer.</p>
            )}
            {canEdit ? (
              <form
                action={saveEmployeeRow}
                className="ep-filter-band"
                style={{ marginTop: 'var(--sp-4)', marginBottom: 0 }}
              >
                {hidden('transfers')}
                <InputField id="tr-on" name="onDate" label="On" type="date" required />
                <InputField id="tr-f" name="fromPlace" label="From" maxLength={200} />
                <InputField id="tr-t" name="toPlace" label="To" maxLength={200} required />
                <InputField id="tr-o" name="orderNo" label="Order number" maxLength={60} />
                <InputField id="tr-r" name="remarks" label="Remarks" maxLength={300} />
                {addButton}
              </form>
            ) : null}
          </Card>
          <Card title="Remarks and history">
            {rows.remarks.length ? (
              <ul
                style={{
                  listStyle: 'none',
                  margin: 0,
                  padding: 0,
                  display: 'grid',
                  gap: 'var(--sp-2)',
                }}
              >
                {rows.remarks.map((x) => (
                  <li
                    key={x.id}
                    style={{
                      display: 'flex',
                      gap: 'var(--sp-2)',
                      justifyContent: 'space-between',
                      alignItems: 'flex-start',
                    }}
                  >
                    <span>
                      <strong>{dmy(x.onDate)}</strong> {x.remark}{' '}
                      <span className="ep-field__help">
                        {x.source === 'system' ? 'by the system' : x.by ? `by ${x.by}` : ''}
                      </span>
                    </span>
                    {x.source === 'office' ? remove('remarks', x.id, 'this remark') : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="ep-field__help">No remark yet.</p>
            )}
            {canEdit ? (
              <form
                action={saveEmployeeRow}
                className="ep-filter-band"
                style={{ marginTop: 'var(--sp-4)', marginBottom: 0 }}
              >
                {hidden('remarks')}
                <InputField id="rm-on" name="onDate" label="On" type="date" />
                <InputField id="rm-r" name="remark" label="Remark" maxLength={1000} required />
                {addButton}
              </form>
            ) : null}
          </Card>
        </div>
      ) : null}

      {tab === 'posting' ? (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 22rem), 1fr))',
            gap: 'var(--sp-4)',
          }}
        >
          <Card title={t('posting')}>
            <DataTable<Posting>
              caption={t('posting')}
              density="dense"
              columns={[
                { key: 'year', header: 'Year', render: (x) => x.academicYear },
                {
                  key: 'designation',
                  header: t('designation'),
                  render: (x) => x.designation ?? '',
                },
                { key: 'department', header: t('department'), render: (x) => x.department ?? '' },
                { key: 'campus', header: t('campus'), render: (x) => x.campus ?? '' },
                { key: 'reportsTo', header: t('reportsTo'), render: (x) => x.reportsTo ?? '' },
                {
                  key: 'valid',
                  header: 'Valid',
                  render: (x) => `${x.validFrom} → ${x.validTo ?? 'open'}`,
                },
              ]}
              rows={employee.postings}
              rowKey={(x) => x.id}
            />
            {canEdit ? (
              <form action={upsertPosting} style={{ marginTop: 'var(--sp-4)' }}>
                <input type="hidden" name="id" value={employee.id} />
                <FormSection title={t('posting')} description={t('postingHelp')}>
                  <FormRow columns={2}>
                    <SelectField
                      id="p-designation"
                      name="designation"
                      label={t('designation')}
                      defaultValue={employee.posting?.designation ?? employee.designation ?? ''}
                      options={withCurrent(
                        list('Designation'),
                        employee.posting?.designation ?? employee.designation,
                      )}
                    />
                    <SelectField
                      id="p-department"
                      name="department"
                      label={t('department')}
                      defaultValue={employee.posting?.department ?? employee.department ?? ''}
                      options={withCurrent(
                        list('Department'),
                        employee.posting?.department ?? employee.department,
                      )}
                    />
                  </FormRow>
                  <FormRow columns={2}>
                    <SelectField
                      id="p-reportsTo"
                      name="reportsToEmployeeId"
                      label={t('reportsTo')}
                      defaultValue={employee.posting?.reportsToEmployeeId ?? ''}
                      options={[
                        { value: '', label: c('none') },
                        ...others.data
                          .filter((e) => e.id !== employee.id)
                          .map((e) => ({
                            value: e.id,
                            label: `${e.displayName} (${e.employeeCode})`,
                          })),
                      ]}
                    />
                    <SelectField
                      id="p-campus"
                      name="campusId"
                      label={t('campus')}
                      defaultValue={employee.posting?.campusId ?? ''}
                      options={[
                        { value: '', label: c('none') },
                        ...(school?.campuses ?? []).map((x) => ({ value: x.id, label: x.name })),
                      ]}
                    />
                  </FormRow>
                  <FormRow columns={2}>
                    <InputField
                      id="p-from"
                      name="validFrom"
                      label="Valid from"
                      type="date"
                      defaultValue={employee.posting?.validFrom ?? ''}
                    />
                    <InputField
                      id="p-to"
                      name="validTo"
                      label="Valid to"
                      type="date"
                      defaultValue={employee.posting?.validTo ?? ''}
                    />
                  </FormRow>
                  <FormActions>
                    <Button type="submit" variant="secondary">
                      {c('save')}
                    </Button>
                  </FormActions>
                </FormSection>
              </form>
            ) : null}
            {employee.directReports.length > 0 ? (
              <p style={{ marginTop: 'var(--sp-3)' }}>
                <span className="ep-kicker">{t('directReports')}</span>{' '}
                {employee.directReports.map((d, i) => (
                  <span key={d.id}>
                    {i > 0 ? ', ' : ''}
                    <a href={`/people/employees/${d.id}`}>{d.displayName}</a>
                  </span>
                ))}
              </p>
            ) : null}
          </Card>
          {employee.documents.length ? (
            <Card title="Earlier files">
              <DataTable<PersonDocument>
                caption={p('students.documents')}
                density="dense"
                columns={[
                  { key: 'kind', header: 'Kind', render: (d) => d.kind },
                  { key: 'file', header: 'File', render: (d) => d.fileName ?? d.fileId },
                  { key: 'expires', header: 'Expires', render: (d) => d.expiresOn ?? '' },
                ]}
                rows={employee.documents}
                rowKey={(d) => d.id}
                emptyTitle={p('students.noDocuments')}
              />
            </Card>
          ) : null}
        </div>
      ) : null}
      {tab === 'acr' ? (
        <Card>
          <h2 className="ep-card__title">Annual confidential reports</h2>
          {!canAcr ? (
            <p className="ep-field__help">You do not have the right to see ACRs.</p>
          ) : acrs.length ? (
            <div className="ep-table-wrap">
              <table className="ep-table">
                <thead>
                  <tr>
                    <th scope="col">Cycle</th>
                    <th scope="col">Status</th>
                    <th scope="col">Waiting on</th>
                    <th scope="col">Self %</th>
                    <th scope="col">Score %</th>
                    <th scope="col">Grade</th>
                  </tr>
                </thead>
                <tbody>
                  {acrs.map((a) => (
                    <tr key={a.id}>
                      <td>
                        <a href={`/people/acr/${a.id}`}>
                          <strong>{a.cycle}</strong>
                        </a>
                      </td>
                      <td>{ACR_STATUS[a.status]}</td>
                      <td>
                        {a.status === 'self'
                          ? 'The employee'
                          : a.level
                            ? `${a.level.label ?? ''}: ${a.level.waitingOn.join(', ') || 'nobody set'}`
                            : '—'}
                      </td>
                      <td>{a.selfPct ?? '—'}</td>
                      <td>{a.scorePct ?? '—'}</td>
                      <td>
                        {a.grade ?? '—'}
                        {a.adverse ? <span className="ep-field__help"> (adverse)</span> : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="ep-field__help">
              No ACR yet. ACRs are started for a year on <a href="/people/acr">Employee ACR</a>.
            </p>
          )}
          <p className="ep-field__help">
            Who assesses this employee: the ACR HOD and L1–L3 approvers on the Profile tab
            (Approvers), used by the levels set in{' '}
            <a href="/people/acr/setup?tab=levels">ACR set-up</a>.
          </p>
        </Card>
      ) : null}
    </>
  );
}
