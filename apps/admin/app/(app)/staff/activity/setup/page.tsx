import { Badge, Button, Card, InputField, PageHeader, SelectField } from '@edupro/ui';
import { ActivityNav } from '@/components/staff/ActivityNav';
import { saveActivityCategory, saveActivitySettings } from '@/lib/activity-actions';
import { apiFetch, getMe } from '@/lib/api';

interface Setup {
  categories: Array<{ id: string; code: string; name: string; sortOrder: number; active: boolean }>;
  cutoffTime: string;
  backDays: number;
}

/** The rules of the daily activity log and the kinds of work an employee picks from. */
export default async function ActivitySetupPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string; detail?: string }>;
}) {
  const sp = await searchParams;
  const [me, s] = await Promise.all([getMe(), apiFetch<Setup>('/staff/activity/setup')]);
  return (
    <>
      <PageHeader
        kicker="Staff · Daily activity log"
        title="Set-up"
        description="When a day must be submitted, how late it may be filled, and the categories of work."
      />
      <ActivityNav current="/staff/activity/setup" permissions={me.permissions} />
      {sp.ok ? (
        <div
          className="ep-alert ep-alert--success"
          role="status"
          style={{ marginBottom: 'var(--sp-3)' }}
        >
          Saved.
        </div>
      ) : null}
      {sp.error ? (
        <div
          className="ep-alert ep-alert--danger"
          role="alert"
          style={{ marginBottom: 'var(--sp-3)' }}
        >
          {sp.detail || 'Could not save.'}
        </div>
      ) : null}
      <Card title="Rules" style={{ marginBottom: 'var(--sp-4)' }}>
        <form
          action={saveActivitySettings}
          style={{ display: 'flex', gap: 'var(--sp-3)', flexWrap: 'wrap', alignItems: 'flex-end' }}
        >
          <InputField
            id="as-cutoff"
            name="cutoffTime"
            label="Submit by (time of the day)"
            type="time"
            required
            defaultValue={s.cutoffTime}
            help="A log submitted later is marked late."
          />
          <InputField
            id="as-back"
            name="backDays"
            label="May be filled how many days later"
            type="number"
            min={0}
            max={30}
            required
            defaultValue={String(s.backDays)}
            help="0 = only on the day itself."
          />
          <Button type="submit">Save</Button>
        </form>
      </Card>
      <Card title="Categories of work">
        <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="Categories">
          <table className="ep-table ep-table--dense">
            <caption className="ep-sr-only">Categories an employee picks from</caption>
            <thead>
              <tr>
                <th scope="col">Category</th>
                <th scope="col">Order</th>
                <th scope="col">State</th>
                <th scope="col">Change</th>
              </tr>
            </thead>
            <tbody>
              {s.categories.map((k) => (
                <tr key={k.id}>
                  <th scope="row">{k.name}</th>
                  <td>{k.sortOrder}</td>
                  <td>
                    <Badge tone={k.active ? 'success' : 'neutral'}>
                      {k.active ? 'Active' : 'Not used'}
                    </Badge>
                  </td>
                  <td>
                    <form
                      action={saveActivityCategory}
                      style={{
                        display: 'flex',
                        gap: 'var(--sp-2)',
                        flexWrap: 'wrap',
                        alignItems: 'center',
                      }}
                    >
                      <input type="hidden" name="id" value={k.id} />
                      <input
                        className="ep-input"
                        name="name"
                        defaultValue={k.name}
                        required
                        maxLength={80}
                        aria-label={`Name of ${k.name}`}
                      />
                      <input
                        className="ep-input"
                        name="sortOrder"
                        type="number"
                        min={0}
                        max={9999}
                        defaultValue={k.sortOrder}
                        aria-label={`Order of ${k.name}`}
                        style={{ maxWidth: '6rem' }}
                      />
                      <select
                        className="ep-select"
                        name="status"
                        defaultValue={k.active ? 'active' : 'inactive'}
                        aria-label={`State of ${k.name}`}
                      >
                        <option value="active">Active</option>
                        <option value="inactive">Not used</option>
                      </select>
                      <Button type="submit" variant="secondary" size="sm">
                        Save
                      </Button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <form
          action={saveActivityCategory}
          style={{
            display: 'flex',
            gap: 'var(--sp-3)',
            flexWrap: 'wrap',
            alignItems: 'flex-end',
            marginTop: 'var(--sp-4)',
          }}
        >
          <InputField id="ac-name" name="name" label="New category" required maxLength={80} />
          <InputField
            id="ac-order"
            name="sortOrder"
            label="Order"
            type="number"
            min={0}
            max={9999}
            defaultValue="100"
          />
          <SelectField
            id="ac-status"
            name="status"
            label="State"
            options={[
              { value: 'active', label: 'Active' },
              { value: 'inactive', label: 'Not used' },
            ]}
          />
          <Button type="submit">Add category</Button>
        </form>
      </Card>
    </>
  );
}
