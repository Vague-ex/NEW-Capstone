"""
Turn a GPS point into this app's own Region / Province / City / Barangay rows.

Used by the "Use my current location" button on registration. The point is sent
to OpenStreetMap's Nominatim reverse geocoder from the SERVER, not the browser:
Nominatim's usage policy wants a real identifying User-Agent (browsers cannot
set one), results cached, and at most one request per second; and the
graduate's IP address never reaches a third party.

Nominatim returns OpenStreetMap's own names ("Bacolod", "Negros Island Region",
"Zone 10") which rarely match the PSA's spelling exactly ("City of Bacolod",
"Negros Island Region (NIR)"). Matching is therefore by normalised variants, and
refuses to guess: an ambiguous name resolves to nothing, and the graduate picks
that field by hand.
"""

from __future__ import annotations

import re
import threading
import time
import unicodedata

import requests
from django.conf import settings
from django.core.cache import cache
from django.db.models import Q

from .models import Barangay, CityMunicipality, Province, Region

NOMINATIM_REVERSE_URL = "https://nominatim.openstreetmap.org/reverse"
ATTRIBUTION = "© OpenStreetMap contributors"
ATTRIBUTION_URL = "https://www.openstreetmap.org/copyright"
REQUEST_TIMEOUT_SECONDS = 8
MIN_SECONDS_BETWEEN_CALLS = 1.1
CACHE_SECONDS = 60 * 60 * 24

# OpenStreetMap names that share no words with the PSA's.
REGION_ALIASES = {
    "metro manila": "1300000000",
    "bangsamoro": "1900000000",
    "autonomous region in muslim mindanao": "1900000000",
}
# Address keys that can hold each level, most specific first. In Philippine
# OSM data the barangay is usually `quarter`; smaller places use the others.
CITY_KEYS = ("city", "town", "municipality", "village", "county")
BARANGAY_KEYS = ("quarter", "suburb", "village", "neighbourhood", "hamlet", "city_district", "residential")
ABBREVIATIONS = {"sta": "santa", "sto": "santo", "pob": "poblacion", "brgy": "barangay", "bgy": "barangay"}


class GeoLookupError(RuntimeError):
    """The geocoder could not be reached or returned something unusable."""


_rate_lock = threading.Lock()
_last_call_at = 0.0


def reverse_geocode(latitude: float, longitude: float) -> dict:
    """Nominatim's reverse result for a point, cached for a day per ~1 m cell."""
    key = f"geo:nominatim:reverse:{latitude:.5f}:{longitude:.5f}"
    cached = cache.get(key)
    if cached is not None:
        return cached

    global _last_call_at
    with _rate_lock:
        wait = MIN_SECONDS_BETWEEN_CALLS - (time.monotonic() - _last_call_at)
        if wait > 0:
            time.sleep(wait)
        try:
            response = requests.get(
                NOMINATIM_REVERSE_URL,
                params={
                    "format": "jsonv2",
                    "lat": f"{latitude:.6f}",
                    "lon": f"{longitude:.6f}",
                    "zoom": 18,
                    "addressdetails": 1,
                    "accept-language": "en",
                },
                headers={"User-Agent": settings.NOMINATIM_USER_AGENT},
                timeout=REQUEST_TIMEOUT_SECONDS,
            )
        except requests.RequestException as exc:
            raise GeoLookupError(f"Geocoder unreachable: {type(exc).__name__}") from exc
        finally:
            _last_call_at = time.monotonic()

    if response.status_code != 200:
        raise GeoLookupError(f"Geocoder returned HTTP {response.status_code}")
    try:
        payload = response.json()
    except ValueError as exc:
        raise GeoLookupError("Geocoder returned invalid JSON") from exc
    if not isinstance(payload, dict):
        raise GeoLookupError("Geocoder returned an unexpected shape")
    # {"error": "Unable to geocode"} is a real answer (e.g. a point at sea):
    # there is simply no address, which the matcher reports as no matches.
    if "error" in payload:
        payload = {"address": {}}
    cache.set(key, payload, CACHE_SECONDS)
    return payload


# ── Name matching ────────────────────────────────────────────────────────────

_PARENTHESISED = re.compile(r"\(([^)]*)\)")


def _fold(text: str | None) -> str:
    """Lower-case, accents removed (Ñ -> n), punctuation to spaces, abbreviations expanded."""
    text = unicodedata.normalize("NFKD", text or "")
    text = "".join(ch for ch in text if not unicodedata.combining(ch)).lower()
    words = re.sub(r"[^a-z0-9]+", " ", text).split()
    return " ".join(ABBREVIATIONS.get(word, word) for word in words)


def _variants(name: str | None) -> set[str]:
    """Every reasonable way the same place name gets written."""
    name = name or ""
    out = {_fold(name), _fold(_PARENTHESISED.sub(" ", name))}
    out.update(_fold(inner) for inner in _PARENTHESISED.findall(name))
    for value in list(out):
        for prefix in ("city of ", "municipality of ", "barangay "):
            if value.startswith(prefix):
                out.add(value[len(prefix):])
        for suffix in (" city", " region"):
            if value.endswith(suffix):
                out.add(value[: -len(suffix)])
    out.discard("")
    return out


def _pick(rows, texts):
    """
    The single row a name refers to, trying each text in priority order.

    An exact (folded) match wins; otherwise any shared variant counts. More than
    one hit for every text means the name is ambiguous, and nothing is returned.
    """
    for text in texts:
        if not text:
            continue
        exact = [row for row in rows if _fold(row.name) == _fold(text)]
        if len(exact) == 1:
            return exact[0]
        wanted = _variants(text)
        loose = [row for row in rows if _variants(row.name) & wanted]
        if len(loose) == 1:
            return loose[0]
    return None


def _ref(row, **extra):
    return None if row is None else {"id": str(row.id), "name": row.name, **extra}


def resolve_location(payload: dict) -> dict:
    """Map a Nominatim reverse result onto this app's reference rows."""
    address = payload.get("address") or {}
    country_code = (address.get("country_code") or "").lower()
    result = {
        "country": address.get("country") or "",
        "country_code": country_code,
        "abroad": bool(country_code) and country_code != "ph",
        "locality": "",
        "state": "",
        "region": None,
        "province": None,
        "city": None,
        "barangay": None,
        "display_name": payload.get("display_name") or "",
        "attribution": ATTRIBUTION,
        "attribution_url": ATTRIBUTION_URL,
    }

    if result["abroad"]:
        result["locality"] = next((address[k] for k in CITY_KEYS if address.get(k)), "")
        result["state"] = address.get("state") or ""
        return result
    if country_code != "ph":
        return result

    regions = list(Region.objects.filter(is_active=True).exclude(psgc_id=""))
    region = None
    for text in (address.get("region"), address.get("state")):
        alias = REGION_ALIASES.get(_fold(text))
        if alias:
            region = next((r for r in regions if r.psgc_id == alias), None)
        if region is None:
            region = _pick(regions, [text])
        if region is not None:
            break

    provinces = Province.objects.filter(is_active=True)
    if region is not None:
        provinces = provinces.filter(region=region)
    province = _pick(list(provinces), [address.get("province"), address.get("state"), address.get("county")])

    cities = CityMunicipality.objects.filter(is_active=True).select_related("region", "province", "home_province")
    if province is not None:
        scoped = cities.filter(Q(province=province) | Q(home_province=province))
    elif region is not None:
        scoped = cities.filter(region=region)
    else:
        scoped = cities
    city = _pick(list(scoped), [address.get(k) for k in CITY_KEYS])

    barangay = None
    if city is not None:
        # The city is the most reliable anchor: derive the levels above it from
        # our own table rather than trusting OSM's spelling of them.
        region = city.region
        province = city.province or city.home_province or province
        barangay = _pick(
            list(Barangay.objects.filter(city=city, is_active=True)),
            [address.get(k) for k in BARANGAY_KEYS],
        )

    result["region"] = _ref(region)
    result["province"] = _ref(province)
    result["city"] = _ref(city, is_city=city.is_city) if city is not None else None
    result["barangay"] = _ref(barangay)
    return result
