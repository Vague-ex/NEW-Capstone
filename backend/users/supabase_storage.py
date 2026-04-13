import json
import os
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlparse
from urllib.request import Request, urlopen

from django.conf import settings


class SupabaseStorageError(Exception):
    def __init__(self, message: str, status_code: int | None = None):
        super().__init__(message)
        self.status_code = status_code


def _derive_supabase_url_from_database_url() -> str:
    database_url = (
        os.getenv("DATABASE_POOLER_URL")
        or os.getenv("SUPABASE_POOLER_URL")
        or os.getenv("DATABASE_URL")
        or ""
    )
    if not database_url:
        return ""

    parsed = urlparse(database_url)
    host = parsed.hostname or ""
    # Direct host format: db.<project-ref>.supabase.co
    if host.startswith("db.") and host.endswith(".supabase.co"):
        parts = host.split(".")
        if len(parts) >= 3:
            return f"https://{parts[1]}.supabase.co"
    return ""


def _get_config() -> tuple[str, str, str]:
    supabase_url = getattr(settings, "SUPABASE_URL", "") or _derive_supabase_url_from_database_url()
    service_role_key = getattr(settings, "SUPABASE_SERVICE_ROLE_KEY", "")
    bucket_name = getattr(settings, "SUPABASE_STORAGE_BUCKET", "faceid-verification")

    if not supabase_url:
        raise SupabaseStorageError(
            "SUPABASE_URL is required for Storage uploads. Set it in backend/.env."
        )
    if not service_role_key:
        raise SupabaseStorageError(
            "SUPABASE_SERVICE_ROLE_KEY is required for Storage uploads. Set it in backend/.env."
        )

    return supabase_url.rstrip("/"), service_role_key, bucket_name


def _request(
    method: str,
    url: str,
    api_key: str,
    payload: bytes | None = None,
    extra_headers: dict[str, str] | None = None,
) -> bytes:
    headers = {
        "apikey": api_key,
        "Authorization": f"Bearer {api_key}",
    }
    if extra_headers:
        headers.update(extra_headers)

    request = Request(url=url, data=payload, headers=headers, method=method)
    try:
        with urlopen(request, timeout=25) as response:
            return response.read()
    except HTTPError as exc:
        body = exc.read().decode("utf-8", errors="ignore")
        message = f"Supabase Storage request failed ({exc.code})."
        if body:
            message = f"{message} {body[:220]}"
        raise SupabaseStorageError(message, status_code=exc.code) from exc
    except URLError as exc:
        raise SupabaseStorageError(f"Supabase Storage request failed: {exc.reason}") from exc


def ensure_bucket_exists() -> None:
    base_url, api_key, bucket_name = _get_config()
    get_url = f"{base_url}/storage/v1/bucket/{quote(bucket_name, safe='')}"

    try:
        _request("GET", get_url, api_key)
        return
    except SupabaseStorageError as exc:
        # Supabase can sometimes return HTTP 400 with a "Bucket not found" payload.
        missing_bucket = exc.status_code == 404 or (
            exc.status_code == 400 and "bucket not found" in str(exc).lower()
        )
        if not missing_bucket:
            raise

    create_url = f"{base_url}/storage/v1/bucket"
    body = json.dumps({"id": bucket_name, "name": bucket_name, "public": True}).encode("utf-8")
    _request(
        "POST",
        create_url,
        api_key,
        payload=body,
        extra_headers={"Content-Type": "application/json"},
    )


def upload_image_bytes(file_bytes: bytes, object_path: str, content_type: str = "image/jpeg") -> str:
    if not file_bytes:
        raise SupabaseStorageError("Cannot upload an empty image file.")

    base_url, api_key, bucket_name = _get_config()
    ensure_bucket_exists()

    normalized_path = object_path.strip("/").replace("\\", "/")
    full_path = f"{bucket_name}/{normalized_path}"
    upload_url = f"{base_url}/storage/v1/object/{quote(full_path, safe='/')}"

    _request(
        "POST",
        upload_url,
        api_key,
        payload=file_bytes,
        extra_headers={
            "Content-Type": content_type,
            "x-upsert": "true",
        },
    )

    return f"{base_url}/storage/v1/object/public/{bucket_name}/{quote(normalized_path, safe='/')}"
