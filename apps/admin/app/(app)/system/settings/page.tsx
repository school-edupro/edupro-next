import { Badge, Button, Card, PageHeader } from '@edupro/ui';
import { Notice } from '@/components/Notice';
import { setSetting } from '@/lib/actions';
import { apiFetch } from '@/lib/api';
import type { Setting } from '@/lib/types';

const ENUMS: Record<string, string[]> = {
  'school.locale': ['en', 'hi'],
  'fees.late_fee_mode': ['daywise', 'slab'],
  'attendance.absent_alert_channel': ['none', 'sms', 'whatsapp', 'push'],
};

function kindOf(s: Setting): 'enum' | 'boolean' | 'number' | 'string' | 'json' {
  if (ENUMS[s.key]) return 'enum';
  if (typeof s.value === 'boolean') return 'boolean';
  if (typeof s.value === 'number') return 'number';
  if (typeof s.value === 'string') return 'string';
  return 'json';
}

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string; detail?: string }>;
}) {
  const sp = await searchParams;
  const settings = await apiFetch<{ data: Setting[] }>('/platform/settings');
  const modules = [...new Set(settings.data.map((s) => s.module))];
  return (
    <>
      <PageHeader
        kicker="System"
        title="School settings"
        description="Typed settings with a validity date. Procedures such as the late-fee rule read these values directly."
      />
      <Notice params={sp} />
      {modules.map((m) => (
        <Card key={m} title={m} style={{ marginBottom: 'var(--sp-4)' }}>
          <div className="ep-table-wrap">
            <table className="ep-table">
              <thead>
                <tr>
                  <th scope="col">Setting</th>
                  <th scope="col">Value</th>
                  <th scope="col">From</th>
                  <th scope="col"></th>
                </tr>
              </thead>
              <tbody>
                {settings.data
                  .filter((s) => s.module === m)
                  .map((s) => {
                    const kind = kindOf(s);
                    const id = `set-${s.key.replace(/\W/g, '-')}`;
                    return (
                      <tr key={s.key}>
                        <td>
                          <code>{s.key}</code>
                          <div className="ep-field__help">{s.description}</div>
                        </td>
                        <td colSpan={3}>
                          <form
                            action={setSetting}
                            style={{
                              display: 'flex',
                              gap: 'var(--sp-2)',
                              alignItems: 'center',
                              flexWrap: 'wrap',
                            }}
                          >
                            <input type="hidden" name="key" value={s.key} />
                            <input
                              type="hidden"
                              name="valueKind"
                              value={kind === 'enum' ? 'string' : kind}
                            />
                            {kind === 'enum' ? (
                              <select
                                id={id}
                                name="value"
                                className="ep-select"
                                defaultValue={String(s.value)}
                                aria-label={s.key}
                              >
                                {ENUMS[s.key]!.map((v) => (
                                  <option key={v} value={v}>
                                    {v}
                                  </option>
                                ))}
                              </select>
                            ) : kind === 'boolean' ? (
                              <select
                                id={id}
                                name="value"
                                className="ep-select"
                                defaultValue={String(s.value)}
                                aria-label={s.key}
                              >
                                <option value="true">yes</option>
                                <option value="false">no</option>
                              </select>
                            ) : kind === 'number' ? (
                              <input
                                id={id}
                                name="value"
                                type="number"
                                className="ep-input"
                                defaultValue={String(s.value)}
                                aria-label={s.key}
                              />
                            ) : kind === 'string' ? (
                              <input
                                id={id}
                                name="value"
                                type="text"
                                className="ep-input"
                                defaultValue={String(s.value)}
                                aria-label={s.key}
                              />
                            ) : (
                              <input
                                id={id}
                                name="value"
                                type="text"
                                className="ep-input"
                                defaultValue={JSON.stringify(s.value)}
                                aria-label={s.key}
                                style={{ minWidth: 280 }}
                              />
                            )}
                            <input
                              name="validFrom"
                              type="date"
                              className="ep-input"
                              aria-label={`${s.key} valid from`}
                            />
                            <Button type="submit" size="sm" variant="secondary">
                              Save
                            </Button>
                            {s.isDefault ? (
                              <Badge tone="neutral">default</Badge>
                            ) : (
                              <Badge tone="info">since {s.validFrom}</Badge>
                            )}
                          </form>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </Card>
      ))}
    </>
  );
}
