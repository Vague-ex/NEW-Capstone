"""Build the bundled placedb country + division file for tracer/data/.

Downloads placedb's country list and each country's first-level divisions, then
writes one gzipped JSON the sync command reads offline. Run again to refresh.
"""
import gzip, json, sys, time, urllib.request

BASE = "https://api.placedb.org/v1"
OUT = sys.argv[1]
UA = "GraduateTracerSystem/1.0 (capstone reference data build)"


def get(path):
    req = urllib.request.Request(f"{BASE}{path}", headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


countries = get("/countries.json")["countries"]
print(f"countries: {len(countries)}")

out_countries, out_divisions = [], []
for i, c in enumerate(countries, 1):
    code = (c.get("code") or "").strip().upper()
    name = (c.get("name") or "").strip()
    if len(code) != 2 or not name:
        print(f"  skip (bad code/name): {c.get('code')!r} {c.get('name')!r}")
        continue
    out_countries.append({"code": code, "name": name})

    try:
        regions = get(f"/regions/{code}.json").get("regions", [])
    except Exception as exc:  # a country with no division file is normal
        print(f"  {code}: no regions ({exc})")
        regions = []

    seen = set()
    for r in regions:
        rname = (r.get("name") or "").strip()
        # placedb files settlements whose division is unknown under this
        # placeholder. It is not a place, so it must not reach a dropdown.
        if rname.casefold() == "division not recorded":
            continue
        if not rname or rname.casefold() in seen:
            continue
        seen.add(rname.casefold())
        out_divisions.append({
            "country": code,
            "name": rname,
            "iso_3166_2": (r.get("iso_3166_2") or "").strip(),
            "lat": r.get("lat"),
            "lon": r.get("lon"),
        })
    if i % 25 == 0:
        print(f"  {i}/{len(countries)} ... {len(out_divisions)} divisions")
    time.sleep(0.05)

payload = {
    "source": "https://placedb.org/ (CC0-1.0, built from Wikidata)",
    "license": "CC0-1.0",
    "countries": sorted(out_countries, key=lambda x: x["name"]),
    "divisions": out_divisions,
}
with gzip.open(OUT, "wt", encoding="utf-8") as fh:
    json.dump(payload, fh, ensure_ascii=False, separators=(",", ":"))
print(f"wrote {OUT}: {len(out_countries)} countries, {len(out_divisions)} divisions")
