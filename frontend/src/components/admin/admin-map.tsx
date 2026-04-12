import { useState, useEffect, useRef } from 'react';
import { PortalLayout } from '../shared/portal-layout';
import { VALID_ALUMNI, GRADUATION_YEARS } from '../../data/app-data';
import { MapPin, Filter, Users, CheckCircle2, AlertTriangle, Globe, Home } from 'lucide-react';

type AlumniRecord = typeof VALID_ALUMNI[0];

const STATUS_COLORS: Record<string, string> = {
  employed: '#10b981',
  'self-employed': '#166534',
  unemployed: '#ef4444',
};
const STATUS_LABELS: Record<string, string> = {
  employed: 'Employed',
  'self-employed': 'Self-Employed',
  unemployed: 'Unemployed',
};

// ── Determine if a graduate is working abroad ─────────────────────────────────
function isAbroad(a: AlumniRecord): boolean {
  const sd = (a as any).surveyData;
  if (sd?.currentJobLocation === 'Abroad / Remote Foreign Employer') return true;
  const loc = ((a.workLocation ?? '') + ' ' + (a.workCity ?? '')).toLowerCase();
  return (
    loc.includes('abroad') ||
    loc.includes('singapore') ||
    loc.includes('dubai') ||
    loc.includes('uae') ||
    loc.includes('saudi') ||
    loc.includes('japan') ||
    loc.includes('usa') ||
    loc.includes('australia') ||
    loc.includes('canada') ||
    loc.includes('uk ') ||
    loc.includes('ofw') ||
    loc.includes('foreign') ||
    loc.includes('international')
  );
}

const pendingCount = VALID_ALUMNI.filter(a => a.verificationStatus === 'pending').length;

export function AdminMap() {
  const mapRef = useRef<HTMLDivElement>(null);
  const leafletMapRef = useRef<any>(null);
  const markersRef = useRef<any[]>([]);

  const [filterYear, setFilterYear] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterLocation, setFilterLocation] = useState<'all' | 'local' | 'abroad'>('all');
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState('');

  const filteredAlumni = VALID_ALUMNI.filter(a => {
    if (!a.lat || !a.lng) return false;
    if (filterYear !== 'all' && a.graduationYear !== parseInt(filterYear)) return false;
    if (filterStatus !== 'all' && a.employmentStatus !== filterStatus) return false;
    if (filterLocation === 'local' && isAbroad(a)) return false;
    if (filterLocation === 'abroad' && !isAbroad(a)) return false;
    return true;
  });

  // All employed/self-employed graduates with location
  const withLocation = VALID_ALUMNI.filter(a => a.lat && a.lng && a.employmentStatus !== 'unemployed');
  const localCount = withLocation.filter(a => !isAbroad(a)).length;
  const abroadCount = withLocation.filter(a => isAbroad(a)).length;

  // Initialize map once
  useEffect(() => {
    if (!mapRef.current || leafletMapRef.current) return;

    if (!document.getElementById('leaflet-css-link')) {
      const link = document.createElement('link');
      link.id = 'leaflet-css-link';
      link.rel = 'stylesheet';
      link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      link.integrity = 'sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=';
      link.crossOrigin = '';
      document.head.appendChild(link);
    }

    import('leaflet').then(({ default: L }) => {
      if (!mapRef.current || leafletMapRef.current) return;

      (L.Icon.Default.prototype as any)._getIconUrl = undefined;
      L.Icon.Default.mergeOptions({
        iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
        iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
        shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
      });

      const map = L.map(mapRef.current, {
        center: [11.5, 122.5],
        zoom: 6,
        zoomControl: true,
        scrollWheelZoom: true,
      });

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 18,
      }).addTo(map);

      leafletMapRef.current = map;
      setMapReady(true);
    }).catch(() => setMapError('Could not load map. Please refresh.'));

    return () => {
      if (leafletMapRef.current) {
        leafletMapRef.current.remove();
        leafletMapRef.current = null;
      }
    };
  }, []);

  // Update markers when filters change
  useEffect(() => {
    if (!leafletMapRef.current || !mapReady) return;

    import('leaflet').then(({ default: L }) => {
      markersRef.current.forEach(m => m.remove());
      markersRef.current = [];

      filteredAlumni.forEach(alumni => {
        if (!alumni.lat || !alumni.lng) return;
        const color = STATUS_COLORS[alumni.employmentStatus];
        const abroad = isAbroad(alumni);

        const icon = L.divIcon({
          className: '',
          html: `<div style="width:${abroad ? 22 : 18}px;height:${abroad ? 22 : 18}px;border-radius:50%;background:${color};border:${abroad ? '3px solid #f59e0b' : '2.5px solid white'};box-shadow:0 2px 6px rgba(0,0,0,0.35);cursor:pointer;" title="${alumni.name}"></div>`,
          iconSize: [abroad ? 22 : 18, abroad ? 22 : 18],
          iconAnchor: [abroad ? 11 : 9, abroad ? 11 : 9],
        });

        const locationBadge = abroad
          ? `<span style="display:inline-block;padding:1px 6px;border-radius:99px;font-size:10px;font-weight:600;background:#fef3c7;color:#d97706;border:1px solid #fcd34d;">Abroad</span>`
          : `<span style="display:inline-block;padding:1px 6px;border-radius:99px;font-size:10px;font-weight:600;background:#d1fae5;color:#065f46;">Local (PH)</span>`;

        const marker = L.marker([alumni.lat, alumni.lng], { icon })
          .addTo(leafletMapRef.current)
          .bindPopup(
            `<div style="font-family:system-ui,sans-serif;min-width:190px;padding:4px 0">
              <p style="margin:0 0 2px;font-weight:700;font-size:13px;color:#111">${alumni.name}</p>
              <p style="margin:0 0 4px;font-size:11px;color:#6b7280">Batch ${alumni.graduationYear}</p>
              <div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:4px;">
                <span style="display:inline-block;padding:2px 8px;border-radius:99px;font-size:11px;font-weight:600;background:${color}20;color:${color};">${STATUS_LABELS[alumni.employmentStatus]}</span>
                ${locationBadge}
              </div>
              ${alumni.company ? `<p style="margin:4px 0 0;font-size:12px;color:#374151">${alumni.jobTitle ?? ''} @ ${alumni.company}</p>` : ''}
              ${alumni.workLocation ? `<p style="margin:2px 0 0;font-size:11px;color:#9ca3af;display:flex;align-items:center;gap:3px;"><span style="font-size:10px">&#128205;</span> ${alumni.workLocation}</p>` : ''}
            </div>`,
            { maxWidth: 240 }
          );
        markersRef.current.push(marker);
      });
    });
  }, [mapReady, filteredAlumni.length, filterYear, filterStatus, filterLocation]);

  const byCity = filteredAlumni.reduce((acc, a) => {
    const city = a.workCity ?? 'Unknown';
    acc[city] = (acc[city] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const topCities = Object.entries(byCity)
    .filter(([c]) => c !== 'Unknown')
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6);

  const countByStatus = (s: string) => filteredAlumni.filter(a => a.employmentStatus === s).length;

  return (
    <PortalLayout
      role="admin"
      pageTitle="Geomapping View"
      pageSubtitle="Employment location clusters — local and international"
      notificationCount={pendingCount}
    >
      <div className="space-y-4 h-full">

        {/* Local vs International Summary */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-xl bg-[#166534]/10 shrink-0">
              <Home className="size-5 text-[#166534]" />
            </div>
            <div>
              <p className="text-gray-900" style={{ fontWeight: 800, fontSize: '1.4rem', lineHeight: 1 }}>{localCount}</p>
              <p className="text-gray-500 text-xs mt-0.5">Local (Philippines)</p>
            </div>
          </div>
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-xl bg-amber-50 shrink-0">
              <Globe className="size-5 text-amber-600" />
            </div>
            <div>
              <p className="text-gray-900" style={{ fontWeight: 800, fontSize: '1.4rem', lineHeight: 1 }}>{abroadCount}</p>
              <p className="text-gray-500 text-xs mt-0.5">International / Abroad</p>
            </div>
          </div>
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-xl bg-emerald-50 shrink-0">
              <Users className="size-5 text-emerald-600" />
            </div>
            <div>
              <p className="text-gray-900" style={{ fontWeight: 800, fontSize: '1.4rem', lineHeight: 1 }}>
                {withLocation.length > 0 ? Math.round(localCount / withLocation.length * 100) : 0}%
              </p>
              <p className="text-gray-500 text-xs mt-0.5">Locally Employed</p>
            </div>
          </div>
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-xl bg-blue-50 shrink-0">
              <MapPin className="size-5 text-blue-600" />
            </div>
            <div>
              <p className="text-gray-900" style={{ fontWeight: 800, fontSize: '1.4rem', lineHeight: 1 }}>{filteredAlumni.length}</p>
              <p className="text-gray-500 text-xs mt-0.5">Shown on Map</p>
            </div>
          </div>
        </div>

        {/* Filter bar */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-4 py-3 flex flex-wrap items-center gap-3">
          <Filter className="size-4 text-gray-400 shrink-0" />
          <span className="text-gray-600 text-sm" style={{ fontWeight: 600 }}>Filters:</span>
          <select value={filterYear} onChange={e => setFilterYear(e.target.value)}
            className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-1.5 text-sm outline-none focus:border-[#166534] focus:ring-2 focus:ring-[#166534]/10">
            <option value="all">All Batches</option>
            {GRADUATION_YEARS.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
            className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-1.5 text-sm outline-none focus:border-[#166534] focus:ring-2 focus:ring-[#166534]/10">
            <option value="all">All Status</option>
            <option value="employed">Employed</option>
            <option value="self-employed">Self-Employed</option>
            <option value="unemployed">Unemployed</option>
          </select>
          <select value={filterLocation} onChange={e => setFilterLocation(e.target.value as any)}
            className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-1.5 text-sm outline-none focus:border-[#166534] focus:ring-2 focus:ring-[#166534]/10">
            <option value="all">All Locations</option>
            <option value="local">Local (Philippines)</option>
            <option value="abroad">International / Abroad</option>
          </select>
          <div className="ml-auto flex items-center gap-3 flex-wrap">
            {/* Legend */}
            {Object.entries(STATUS_LABELS).map(([k, v]) => (
              <div key={k} className="flex items-center gap-1.5">
                <span className="size-3 rounded-full border-2 border-white shadow-sm" style={{ background: STATUS_COLORS[k] }} />
                <span className="text-gray-500 text-xs">{v}</span>
              </div>
            ))}
            <div className="flex items-center gap-1.5">
              <span className="size-3.5 rounded-full border-2 border-amber-400 bg-emerald-500 shadow-sm" />
              <span className="text-gray-500 text-xs">Abroad</span>
            </div>
          </div>
        </div>

        <div className="grid lg:grid-cols-4 gap-4">
          {/* Map */}
          <div className="lg:col-span-3 bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden relative h-72 sm:h-96 lg:h-[540px]">
            <div ref={mapRef} style={{ width: '100%', height: '100%', zIndex: 1 }} />
            {!mapReady && !mapError && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-50 z-10">
                <span className="size-8 border-4 border-[#166534]/20 border-t-[#166534] rounded-full animate-spin mb-3" />
                <p className="text-gray-500 text-sm">Loading map…</p>
              </div>
            )}
            {mapError && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-50 z-10">
                <AlertTriangle className="size-8 text-amber-400 mb-3" />
                <p className="text-gray-600 text-sm">{mapError}</p>
              </div>
            )}
          </div>

          {/* Side Panel */}
          <div className="grid grid-cols-2 lg:grid-cols-1 gap-3 lg:h-[540px] lg:overflow-y-auto">

            {/* Work Location */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
              <h3 className="text-gray-800 mb-3 flex items-center gap-2" style={{ fontWeight: 700 }}>
                <Globe className="size-4 text-[#166534]" /> Work Location
              </h3>
              <div className="space-y-2.5">
                {[
                  { label: 'Local (Philippines)', count: filteredAlumni.filter(a => !isAbroad(a)).length, color: '#166534', bg: 'bg-[#166534]/10', icon: Home },
                  { label: 'International / Abroad', count: filteredAlumni.filter(a => isAbroad(a)).length, color: '#d97706', bg: 'bg-amber-50', icon: Globe },
                ].map(item => {
                  const pct = filteredAlumni.length ? Math.round(item.count / filteredAlumni.length * 100) : 0;
                  return (
                    <div key={item.label}>
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-1.5">
                          <item.icon className="size-3.5" style={{ color: item.color }} />
                          <span className="text-gray-600 text-xs">{item.label}</span>
                        </div>
                        <span className="text-gray-800 text-xs" style={{ fontWeight: 700 }}>{item.count} ({pct}%)</span>
                      </div>
                      <div className="w-full bg-gray-100 rounded-full h-2">
                        <div className="h-2 rounded-full transition-all duration-500"
                          style={{ width: `${pct}%`, background: item.color }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Employment Distribution */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
              <h3 className="text-gray-800 mb-3 flex items-center gap-2" style={{ fontWeight: 700 }}>
                <Users className="size-4 text-[#166534]" /> Employment
              </h3>
              <div className="space-y-2">
                {Object.entries(STATUS_LABELS).map(([k, v]) => {
                  const count = countByStatus(k);
                  const pct = filteredAlumni.length ? Math.round(count / filteredAlumni.length * 100) : 0;
                  return (
                    <div key={k}>
                      <div className="flex items-center justify-between mb-0.5">
                        <span className="text-gray-600 text-xs">{v}</span>
                        <span className="text-gray-800 text-xs" style={{ fontWeight: 700 }}>{count} ({pct}%)</span>
                      </div>
                      <div className="w-full bg-gray-100 rounded-full h-1.5">
                        <div className="h-1.5 rounded-full transition-all duration-500"
                          style={{ width: `${pct}%`, background: STATUS_COLORS[k] }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Top Cities */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
              <h3 className="text-gray-800 mb-3 flex items-center gap-2" style={{ fontWeight: 700 }}>
                <MapPin className="size-4 text-[#166534]" /> Top Locations
              </h3>
              {topCities.length === 0 ? (
                <p className="text-gray-400 text-xs text-center py-2">No location data</p>
              ) : (
                <div className="space-y-1.5">
                  {topCities.map(([city, count], i) => {
                    const abroad = isAbroad({ workCity: city } as any) || city.toLowerCase().includes('singapore') || city.toLowerCase().includes('dubai');
                    return (
                      <div key={city} className="flex items-center justify-between py-1.5 border-b border-gray-50 last:border-0">
                        <div className="flex items-center gap-2">
                          <span className="text-gray-400 text-xs w-4">{i + 1}.</span>
                          <span className="text-gray-700 text-xs" style={{ fontWeight: 500 }}>{city}</span>
                          {abroad && (
                            <span className="text-amber-600 bg-amber-50 text-xs px-1.5 py-0.5 rounded" style={{ fontSize: '10px', fontWeight: 600 }}>Abroad</span>
                          )}
                        </div>
                        <span className="text-[#166534] text-xs" style={{ fontWeight: 700 }}>{count}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Biometric Status */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
              <h3 className="text-gray-800 mb-3" style={{ fontWeight: 700 }}>Biometric</h3>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="size-4 text-emerald-500" />
                    <span className="text-gray-600 text-xs">Captured</span>
                  </div>
                  <span className="text-gray-800 text-xs" style={{ fontWeight: 700 }}>
                    {filteredAlumni.filter(a => a.biometricCaptured).length}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="size-4 text-amber-400" />
                    <span className="text-gray-600 text-xs">Pending</span>
                  </div>
                  <span className="text-gray-800 text-xs" style={{ fontWeight: 700 }}>
                    {filteredAlumni.filter(a => !a.biometricCaptured).length}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </PortalLayout>
  );
}