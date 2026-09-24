import { useEffect, useMemo, useState } from 'react';
import { LocateFixed } from 'lucide-react';
import { describeGpsFailure, locateDevice } from '../../app/geolocation';
import HomeLocationMap from '../home-location-map';
import {
  useReferenceData,
  provincesApi,
  citiesApi,
  barangaysApi,
  locationApi,
  type RegionItem,
  type ProvinceItem,
  type CityMunicipalityItem,
  type BarangayItem,
} from '../../hooks/useReferenceData';

export interface HomeAddress {
  region: string;
  province: string;
  city: string;
  barangay: string;
  lat: number | null;
  lng: number | null;
}

// Permanent address for the Personal & Education page: the same Region ->
// Province -> City -> Barangay lists and "Use my current location" as
// registration (register-alumni-personal.tsx), Philippine addresses only.
export function HomeAddressFields({ value, onChange, inputCls }: {
  value: HomeAddress;
  onChange: (next: HomeAddress) => void;
  inputCls: string;
}) {
  const set = (patch: Partial<HomeAddress>) => onChange({ ...value, ...patch });

  const { data: referenceData } = useReferenceData();
  const regions: RegionItem[] = useMemo(() => {
    const list = referenceData?.regions ?? [];
    return Array.from(new Map(list.map(r => [r.name, r])).values());
  }, [referenceData]);
  const [provinces, setProvinces] = useState<ProvinceItem[]>([]);
  const [cities, setCities] = useState<CityMunicipalityItem[]>([]);
  const [barangays, setBarangays] = useState<BarangayItem[]>([]);

  const region = regions.find(r => r.name === value.region);
  useEffect(() => {
    if (!region) { setProvinces([]); return; }
    let active = true;
    void provincesApi.list(region.id)
      .then(({ provinces: list }) => { if (active) setProvinces(list); })
      .catch(() => { if (active) setProvinces([]); });
    return () => { active = false; };
  }, [region?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!region) { setCities([]); return; }
    let active = true;
    const province = provinces.find(p => p.name === value.province);
    const query = province ? { provinceId: province.id } : provinces.length === 0 ? { regionId: region.id } : null;
    if (!query) { setCities([]); return; }
    void citiesApi.list(query)
      .then(({ cities: list }) => { if (active) setCities(list); })
      .catch(() => { if (active) setCities([]); });
    return () => { active = false; };
  }, [region?.id, value.province, provinces]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const city = cities.find(c => c.name === value.city);
    if (!city) { setBarangays([]); return; }
    let active = true;
    void barangaysApi.list(city.id)
      .then(({ barangays: list }) => { if (active) setBarangays(list); })
      .catch(() => { if (active) setBarangays([]); });
    return () => { active = false; };
  }, [value.city, cities]);

  const [locating, setLocating] = useState(false);
  const [note, setNote] = useState<{ tone: 'ok' | 'warn' | 'error'; text: string } | null>(null);

  const fillFromPoint = async (lat: number, lng: number) => {
    const withPin = { ...value, lat, lng };
    try {
      const found = await locationApi.lookup(lat, lng);
      if (found.abroad || (!found.region && !found.city)) {
        onChange(withPin);
        setNote({ tone: 'warn', text: "We pinned your location but couldn't match a Philippine address. Please choose it below." });
        return;
      }
      onChange({
        ...withPin,
        region: found.region?.name ?? value.region,
        province: found.province?.name ?? '',
        city: found.city?.name ?? '',
        barangay: found.barangay?.name ?? '',
      });
      const missing = [!found.city && 'city', !found.barangay && 'barangay'].filter(Boolean);
      setNote(missing.length
        ? { tone: 'warn', text: `We filled in what we could. Please choose your ${missing.join(' and ')} below.` }
        : { tone: 'ok', text: 'Address filled in from your location. Please check it and adjust anything that is off.' });
    } catch (err) {
      onChange(withPin);
      setNote({ tone: 'warn', text: err instanceof Error && err.message ? err.message : "We couldn't look up your address. Please fill it in below." });
    }
  };

  const fillFromMyLocation = async () => {
    setNote(null);
    setLocating(true);
    try {
      const { fix, failure } = await locateDevice();
      if (!fix) { setNote({ tone: 'error', text: describeGpsFailure(failure) }); return; }
      await fillFromPoint(fix.lat, fix.lng);
    } finally {
      setLocating(false);
    }
  };

  const labelCls = 'block text-gray-500 text-xs mb-1.5';
  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-emerald-100 bg-emerald-50/60 p-3 space-y-2.5">
        <div className="flex flex-col sm:flex-row sm:items-center gap-2.5">
          <button
            type="button"
            onClick={() => void fillFromMyLocation()}
            disabled={locating}
            className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg bg-[#166534] hover:bg-[#14532d] disabled:opacity-60 text-white px-3.5 py-2.5 text-sm transition"
            style={{ fontWeight: 600 }}
          >
            {locating
              ? <span className="size-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              : <LocateFixed className="size-4" />}
            {locating ? 'Finding your location…' : value.lat != null ? 'Update my location' : 'Use my current location'}
          </button>
          <p className="text-[11px] text-emerald-900/80 leading-snug">
            Fills in your address from your location. Every field stays editable.
          </p>
        </div>
        {note && (
          <p role="status" className={`text-xs leading-snug ${note.tone === 'ok' ? 'text-emerald-800' : note.tone === 'warn' ? 'text-amber-700' : 'text-red-600'}`}>
            {note.text}
          </p>
        )}
        {value.lat != null && value.lng != null && (
          <div className="space-y-1.5">
            <HomeLocationMap lat={value.lat} lng={value.lng} onMove={(la, ln) => void fillFromPoint(la, ln)} />
            <div className="flex items-center justify-between text-[11px] text-gray-500">
              <span>Drag the pin or tap the map if it is off.</span>
              <button type="button" onClick={() => { set({ lat: null, lng: null }); setNote(null); }} className="underline hover:text-gray-700">
                Remove pin
              </button>
            </div>
          </div>
        )}
      </div>

      <div>
        <label className={labelCls}>Region</label>
        <select value={value.region} className={inputCls}
          onChange={(e) => set({ region: e.target.value, province: '', city: '', barangay: '' })}>
          <option value="">Select Region</option>
          {value.region && !region && <option value={value.region}>{value.region}</option>}
          {regions.map(r => <option key={r.id} value={r.name}>{r.name}</option>)}
        </select>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className={labelCls}>State/Province</label>
          <select value={value.province} className={inputCls} disabled={!value.region || (provinces.length === 0 && !value.province)}
            onChange={(e) => set({ province: e.target.value, city: '', barangay: '' })}>
            <option value="">{provinces.length === 0 && value.region ? 'No provinces (pick city below)' : 'Select Province'}</option>
            {value.province && !provinces.some(p => p.name === value.province) && <option value={value.province}>{value.province}</option>}
            {provinces.map(p => <option key={p.id} value={p.name}>{p.name}</option>)}
          </select>
        </div>
        <div>
          <label className={labelCls}>City/Municipality</label>
          <select value={value.city} className={inputCls} disabled={cities.length === 0 && !value.city}
            onChange={(e) => set({ city: e.target.value, barangay: '' })}>
            <option value="">Select City</option>
            {value.city && !cities.some(c => c.name === value.city) && <option value={value.city}>{value.city}</option>}
            {cities.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
          </select>
        </div>
      </div>
      <div>
        <label className={labelCls}>Barangay <span className="text-gray-400">(optional)</span></label>
        {barangays.length > 0 ? (
          <select value={value.barangay} className={inputCls} onChange={(e) => set({ barangay: e.target.value })}>
            <option value="">Select Barangay</option>
            {barangays.map(b => <option key={b.id} value={b.name}>{b.name}</option>)}
          </select>
        ) : (
          <input type="text" value={value.barangay} className={inputCls} disabled={!value.city}
            placeholder={value.city ? 'Enter barangay' : 'Select a city first'}
            onChange={(e) => set({ barangay: e.target.value })} />
        )}
      </div>
    </div>
  );
}
