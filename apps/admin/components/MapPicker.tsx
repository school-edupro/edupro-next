'use client';
import { useEffect, useRef, useState } from 'react';
import 'leaflet/dist/leaflet.css';

interface Place {
  name: string;
  lat: number;
  lng: number;
}
const round = (n: number) => Math.round(n * 1e6) / 1e6;
const valid = (lat: number, lng: number) =>
  Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;

/**
 * Latitude and longitude of a place, set on a map: search a place name, click the map or drag the pin.
 * The two numbers are ordinary form fields (`f:lat`, `f:lng`) and can be typed too; both optional.
 */
export function MapPicker({ lat, lng }: { lat: string; lng: string }) {
  const [la, setLa] = useState(lat);
  const [lo, setLo] = useState(lng);
  const [query, setQuery] = useState('');
  const [places, setPlaces] = useState<Place[]>([]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const move = useRef<(a: number, b: number, zoom?: number) => void>(() => undefined);

  useEffect(() => {
    let map: import('leaflet').Map | undefined;
    let gone = false;
    void import('leaflet').then((L) => {
      if (gone || !box.current) return;
      const has = valid(Number(lat), Number(lng)) && lat !== '' && lng !== '';
      // no place yet: the middle of India, zoomed out
      const start: [number, number] = has ? [Number(lat), Number(lng)] : [21.15, 79.09];
      map = L.map(box.current, { scrollWheelZoom: false }).setView(start, has ? 15 : 5);
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '© OpenStreetMap contributors',
      }).addTo(map);
      const pin = L.marker(start, {
        draggable: true,
        keyboard: true,
        title: 'Drag to the stoppage',
        icon: L.divIcon({ className: 'ep-map__pin', iconSize: [24, 24], iconAnchor: [12, 24] }),
      }).addTo(map);
      const put = (a: number, b: number) => {
        setLa(String(round(a)));
        setLo(String(round(b)));
      };
      pin.on('dragend', () => {
        const p = pin.getLatLng();
        put(p.lat, p.lng);
      });
      map.on('click', (e) => {
        pin.setLatLng(e.latlng);
        put(e.latlng.lat, e.latlng.lng);
      });
      move.current = (a, b, zoom) => {
        pin.setLatLng([a, b]);
        map?.setView([a, b], zoom ?? Math.max(map.getZoom(), 15));
      };
    });
    return () => {
      gone = true;
      map?.remove();
    };
    // the map is made once, from the first values; later changes go through move.current
  }, []);

  const typed = (a: string, b: string) => {
    if (a !== '' && b !== '' && valid(Number(a), Number(b))) move.current(Number(a), Number(b));
  };
  const search = async () => {
    if (query.trim().length < 3) return setNote('Type at least 3 letters of the place.');
    setBusy(true);
    setNote('');
    try {
      const r = await fetch(`/api/geo/search?q=${encodeURIComponent(query.trim())}`, {
        cache: 'no-store',
      });
      const body = (await r.json()) as { data?: Place[]; error?: string };
      setPlaces(body.data ?? []);
      setNote(
        body.error ??
          ((body.data ?? []).length ? '' : 'No place found. Try the area and the city.'),
      );
    } catch {
      setNote('The place search could not be reached. Drag the pin instead.');
    } finally {
      setBusy(false);
    }
  };
  const choose = (p: Place) => {
    setLa(String(round(p.lat)));
    setLo(String(round(p.lng)));
    move.current(p.lat, p.lng, 16);
    setPlaces([]);
  };

  return (
    <div className="ep-map">
      <div className="ep-map__search">
        <label className="ep-field" htmlFor="map-q">
          <span className="ep-field__label">Search location</span>
          <input
            id="map-q"
            className="ep-input"
            type="search"
            maxLength={120}
            placeholder="Area, landmark, city"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void search();
              }
            }}
          />
        </label>
        <button type="button" className="ep-btn ep-btn--secondary" onClick={search} disabled={busy}>
          {busy ? 'Searching…' : 'Search'}
        </button>
      </div>
      <p className="ep-field__help" role="status" aria-live="polite">
        {note ||
          'Optional: search a place, click the map or drag the pin to set the latitude and longitude.'}
      </p>
      {places.length ? (
        <ul className="ep-map__places" aria-label="Places found">
          {places.map((p) => (
            <li key={`${String(p.lat)},${String(p.lng)}`}>
              <button
                type="button"
                className="ep-btn ep-btn--ghost ep-btn--sm"
                onClick={() => choose(p)}
              >
                {p.name}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="ep-map__coords">
        <label className="ep-field" htmlFor="f-lat">
          <span className="ep-field__label">Latitude</span>
          <input
            id="f-lat"
            name="f:lat"
            className="ep-input"
            type="number"
            step="0.000001"
            min={-90}
            max={90}
            value={la}
            onChange={(e) => {
              setLa(e.target.value);
              typed(e.target.value, lo);
            }}
          />
        </label>
        <label className="ep-field" htmlFor="f-lng">
          <span className="ep-field__label">Longitude</span>
          <input
            id="f-lng"
            name="f:lng"
            className="ep-input"
            type="number"
            step="0.000001"
            min={-180}
            max={180}
            value={lo}
            onChange={(e) => {
              setLo(e.target.value);
              typed(la, e.target.value);
            }}
          />
        </label>
        <button
          type="button"
          className="ep-btn ep-btn--ghost ep-btn--sm"
          onClick={() => {
            setLa('');
            setLo('');
          }}
        >
          Clear
        </button>
      </div>
      <div
        ref={box}
        className="ep-map__box"
        role="application"
        aria-label="Map: click or drag the pin to set the place"
      />
    </div>
  );
}
