#!/usr/bin/env python
"""Reset transactional alumni/auth data and Supabase face-storage objects.

Usage examples:
  Dry run (default):
    python backend/scripts/reset_demo_data.py

  Execute destructive reset:
    python backend/scripts/reset_demo_data.py --execute --confirm RESET

  Keep admin auth accounts:
    python backend/scripts/reset_demo_data.py --execute --confirm RESET --keep-admin

  Database only:
    python backend/scripts/reset_demo_data.py --execute --confirm RESET --skip-storage

    Full clean including reference + master records:
        python backend/scripts/reset_demo_data.py --execute --confirm RESET --include-reference --include-master
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen


BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "core.settings")

import django  # noqa: E402


django.setup()

from django.conf import settings  # noqa: E402
from django.db import transaction  # noqa: E402
from tracer.models import (  # noqa: E402
    AlumniSkill,
    EmploymentRecord,
    Industry,
    JobTitle,
    Region,
    Skill,
    SkillCategory,
    VerificationDecision,
    VerificationToken,
)
from users.models import (  # noqa: E402
    AdminCredential,
    AlumniAccount,
    AlumniProfile,
    EmployerAccount,
    FaceScan,
    GraduateMasterRecord,
    LoginAudit,
    User,
)


@dataclass
class StorageConfig:
    base_url: str
    api_key: str
    bucket: str


class StorageError(Exception):
    pass


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Reset DB transactional data and Supabase storage for GradTracer demo/dev environments."
    )
    parser.add_argument(
        "--execute",
        action="store_true",
        help="Perform destructive operations. Without this flag, script runs in dry-run mode.",
    )
    parser.add_argument(
        "--confirm",
        default="",
        help='Safety token for destructive mode. Required value: "RESET".',
    )
    parser.add_argument(
        "--keep-admin",
        action="store_true",
        help="Keep admin user/auth rows while still clearing alumni/employer transactional data.",
    )
    parser.add_argument(
        "--skip-database",
        action="store_true",
        help="Skip database cleanup phase.",
    )
    parser.add_argument(
        "--skip-storage",
        action="store_true",
        help="Skip Supabase storage cleanup phase.",
    )
    parser.add_argument(
        "--include-reference",
        action="store_true",
        help="Also remove tracer reference rows (skills, categories, industries, job titles, regions).",
    )
    parser.add_argument(
        "--include-master",
        action="store_true",
        help="Also remove users graduate master records.",
    )
    parser.add_argument(
        "--storage-prefix",
        action="append",
        dest="storage_prefixes",
        help="Storage prefix to remove. Can be used multiple times.",
    )
    return parser.parse_args()


def should_execute(args: argparse.Namespace) -> bool:
    if not args.execute:
        return False
    if args.confirm != "RESET":
        raise SystemExit('Destructive mode requires --confirm RESET')
    return True


def print_section(title: str) -> None:
    print("\n" + "=" * 78)
    print(title)
    print("=" * 78)


def get_storage_config() -> StorageConfig | None:
    base_url = (getattr(settings, "SUPABASE_URL", "") or "").rstrip("/")
    api_key = getattr(settings, "SUPABASE_SERVICE_ROLE_KEY", "") or ""
    bucket = getattr(settings, "SUPABASE_STORAGE_BUCKET", "faceid-verification") or "faceid-verification"

    if not base_url or not api_key:
        return None

    return StorageConfig(base_url=base_url, api_key=api_key, bucket=bucket)


def storage_request(
    cfg: StorageConfig,
    method: str,
    path: str,
    payload: bytes | None = None,
    extra_headers: dict[str, str] | None = None,
) -> bytes:
    headers = {
        "apikey": cfg.api_key,
        "Authorization": f"Bearer {cfg.api_key}",
    }
    if extra_headers:
        headers.update(extra_headers)

    req = Request(
        url=f"{cfg.base_url}{path}",
        data=payload,
        headers=headers,
        method=method,
    )

    try:
        with urlopen(req, timeout=30) as response:
            return response.read()
    except HTTPError as exc:
        body = exc.read().decode("utf-8", errors="ignore")
        raise StorageError(f"HTTP {exc.code} on {path}: {body[:240]}") from exc
    except URLError as exc:
        raise StorageError(f"Network error on {path}: {exc.reason}") from exc


def normalize_prefix(prefix: str) -> str:
    cleaned = prefix.strip().replace("\\", "/").strip("/")
    if not cleaned:
        return ""
    return cleaned + "/"


def list_storage_entries(cfg: StorageConfig, prefix: str, offset: int = 0, limit: int = 1000) -> list[dict]:
    body = json.dumps(
        {
            "prefix": prefix,
            "offset": offset,
            "limit": limit,
            "sortBy": {"column": "name", "order": "asc"},
        }
    ).encode("utf-8")

    raw = storage_request(
        cfg,
        "POST",
        f"/storage/v1/object/list/{quote(cfg.bucket, safe='')}",
        payload=body,
        extra_headers={"Content-Type": "application/json"},
    )

    try:
        parsed = json.loads(raw.decode("utf-8") or "[]")
    except json.JSONDecodeError as exc:
        raise StorageError("Failed to parse storage list response.") from exc

    return parsed if isinstance(parsed, list) else []


def list_storage_objects_recursive(cfg: StorageConfig, root_prefix: str) -> list[str]:
    queue = [normalize_prefix(root_prefix)]
    found: set[str] = set()

    while queue:
        current_prefix = queue.pop(0)
        offset = 0
        page_size = 1000

        while True:
            entries = list_storage_entries(cfg, current_prefix, offset=offset, limit=page_size)
            if not entries:
                break

            for entry in entries:
                name = str(entry.get("name") or "").strip().strip("/")
                if not name:
                    continue

                is_folder = entry.get("id") is None
                if is_folder:
                    queue.append(f"{current_prefix}{name}/")
                else:
                    found.add(f"{current_prefix}{name}")

            if len(entries) < page_size:
                break
            offset += page_size

    return sorted(found)


def delete_storage_object(cfg: StorageConfig, object_path: str) -> None:
    encoded_path = quote(object_path, safe="/")
    storage_request(cfg, "DELETE", f"/storage/v1/object/{quote(cfg.bucket, safe='')}/{encoded_path}")


def get_db_counts(
    include_admin: bool,
    include_reference: bool,
    include_master: bool,
) -> dict[str, int]:
    roles = [User.Role.ALUMNI, User.Role.EMPLOYER]
    if include_admin:
        roles.append(User.Role.ADMIN)

    counts = {
        "users_accounts(selected roles)": User.objects.filter(role__in=roles).count(),
        "users_alumni_accounts": AlumniAccount.objects.count(),
        "users_alumni_profiles": AlumniProfile.objects.count(),
        "users_face_scans": FaceScan.objects.count(),
        "users_login_audits": LoginAudit.objects.count(),
        "users_employer_accounts": EmployerAccount.objects.count(),
        "users_admin_credentials": AdminCredential.objects.count(),
        "tracer_employment_records": EmploymentRecord.objects.count(),
        "tracer_alumni_skills": AlumniSkill.objects.count(),
        "tracer_verification_tokens": VerificationToken.objects.count(),
        "tracer_verification_decisions": VerificationDecision.objects.count(),
    }

    if include_reference:
        counts.update(
            {
                "tracer_skill_categories": SkillCategory.objects.count(),
                "tracer_skills": Skill.objects.count(),
                "tracer_industries": Industry.objects.count(),
                "tracer_job_titles": JobTitle.objects.count(),
                "tracer_regions": Region.objects.count(),
            }
        )

    if include_master:
        counts["users_graduate_master_records"] = GraduateMasterRecord.objects.count()

    return counts


def print_counts(title: str, counts: dict[str, int]) -> None:
    print(title)
    for key, value in counts.items():
        print(f"  - {key}: {value}")


def reset_database(
    include_admin: bool,
    include_reference: bool,
    include_master: bool,
    execute: bool,
) -> None:
    print_section("Database Cleanup")
    before = get_db_counts(include_admin, include_reference, include_master)
    print_counts("Current counts:", before)

    if not execute:
        print("Dry-run: database changes were not applied.")
        return

    roles = [User.Role.ALUMNI, User.Role.EMPLOYER]
    if include_admin:
        roles.append(User.Role.ADMIN)

    with transaction.atomic():
        VerificationDecision.objects.all().delete()
        VerificationToken.objects.all().delete()
        AlumniSkill.objects.all().delete()
        EmploymentRecord.objects.all().delete()

        LoginAudit.objects.all().delete()
        FaceScan.objects.all().delete()
        AlumniProfile.objects.all().delete()
        AlumniAccount.objects.all().delete()
        EmployerAccount.objects.all().delete()

        if include_admin:
            AdminCredential.objects.all().delete()

        if include_reference:
            JobTitle.objects.all().delete()
            Skill.objects.all().delete()
            SkillCategory.objects.all().delete()
            Region.objects.all().delete()
            Industry.objects.all().delete()

        if include_master:
            GraduateMasterRecord.objects.all().delete()

        User.objects.filter(role__in=roles).delete()

    after = get_db_counts(include_admin, include_reference, include_master)
    print_counts("Counts after reset:", after)


def reset_storage(prefixes: Iterable[str], execute: bool) -> None:
    print_section("Supabase Storage Cleanup")
    cfg = get_storage_config()
    if not cfg:
        print("Storage cleanup skipped: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing.")
        return

    normalized_prefixes = [normalize_prefix(prefix) for prefix in prefixes if normalize_prefix(prefix)]
    if not normalized_prefixes:
        print("Storage cleanup skipped: no valid prefixes provided.")
        return

    total_files = 0
    total_deleted = 0
    errors: list[str] = []

    for prefix in normalized_prefixes:
        try:
            files = list_storage_objects_recursive(cfg, prefix)
        except StorageError as exc:
            errors.append(f"Failed to list prefix '{prefix}': {exc}")
            continue

        print(f"Prefix '{prefix}' objects found: {len(files)}")
        total_files += len(files)

        if not execute:
            continue

        for object_path in files:
            try:
                delete_storage_object(cfg, object_path)
                total_deleted += 1
            except StorageError as exc:
                errors.append(f"Failed to delete '{object_path}': {exc}")

    if not execute:
        print(f"Dry-run: would remove {total_files} storage object(s).")
    else:
        print(f"Deleted {total_deleted} storage object(s).")

    if errors:
        print("Storage warnings/errors:")
        for msg in errors:
            print(f"  - {msg}")


def main() -> None:
    args = parse_args()
    execute = should_execute(args)

    prefixes = args.storage_prefixes or ["face-registration/", "face-login/"]

    print_section("Reset Mode")
    print(f"Execute destructive operations: {execute}")
    print(f"Keep admin accounts: {args.keep_admin}")
    print(f"Skip database cleanup: {args.skip_database}")
    print(f"Skip storage cleanup: {args.skip_storage}")
    print(f"Include reference tables: {args.include_reference}")
    print(f"Include graduate master records: {args.include_master}")
    print(f"Storage prefixes: {', '.join(prefixes)}")

    if not args.skip_database:
        reset_database(
            include_admin=not args.keep_admin,
            include_reference=args.include_reference,
            include_master=args.include_master,
            execute=execute,
        )
    else:
        print("Database cleanup skipped by flag.")

    if not args.skip_storage:
        reset_storage(prefixes=prefixes, execute=execute)
    else:
        print("Storage cleanup skipped by flag.")

    print_section("Done")
    if execute:
        print("Reset completed.")
    else:
        print("Dry-run completed. Re-run with --execute --confirm RESET to apply changes.")


if __name__ == "__main__":
    main()
