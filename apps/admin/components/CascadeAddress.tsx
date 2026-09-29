'use client';
import { useMemo, useState } from 'react';
import { RefDatalist, type DatalistOption } from './RefDatalist';

/**
 * Country → state → city for the school profile: three typeahead datalists where the state list is
 * narrowed by the chosen country and the city list by the chosen state. Values are the master rows'
 * names (what the address stores); the codes travel as labels.
 */
export function CascadeAddress({
  countries,
  states,
  cities,
  defaults,
}: {
  countries: Array<{ code: string; name: string }>;
  states: Array<{ code: string; name: string; country: string }>;
  cities: Array<{ name: string; state: string; pincode?: string | null }>;
  defaults: { country: string; state: string; city: string };
}) {
  const countryOptions: DatalistOption[] = useMemo(
    () => countries.map((c) => ({ value: c.name, label: c.code })),
    [countries],
  );
  const codeToCountryName = useMemo(
    () => new Map(countries.map((c) => [c.code, c.name])),
    [countries],
  );
  const stateOptions: DatalistOption[] = useMemo(
    () =>
      states.map((s) => ({
        value: s.name,
        label: s.code,
        parent: codeToCountryName.get(s.country) ?? s.country,
      })),
    [states, codeToCountryName],
  );
  const codeToStateName = useMemo(() => new Map(states.map((s) => [s.code, s.name])), [states]);
  const cityOptions: DatalistOption[] = useMemo(
    () =>
      cities.map((c) => ({
        value: c.name,
        label: c.pincode ?? '',
        parent: codeToStateName.get(c.state) ?? c.state,
      })),
    [cities, codeToStateName],
  );
  const [country, setCountry] = useState(defaults.country || 'India');
  const [state, setState] = useState(defaults.state);
  return (
    <>
      <RefDatalist
        id="a-country"
        name="country"
        label="Country"
        defaultValue={country}
        options={countryOptions}
        onValue={(v) => {
          setCountry(v);
          setState('');
        }}
      />
      <RefDatalist
        key={`state-${country}`}
        id="a-state"
        name="state"
        label="State"
        defaultValue={state}
        options={stateOptions.filter((o) => !country || o.parent === country)}
        help={country ? undefined : 'Choose the country first'}
        onValue={setState}
      />
      <RefDatalist
        key={`city-${state}`}
        id="a-city"
        name="city"
        label="City"
        defaultValue={defaults.city}
        options={cityOptions.filter((o) => !state || o.parent === state)}
        help={state ? undefined : 'Choose the state first'}
      />
    </>
  );
}
