"""Django settings for core project."""

import os
import socket
from pathlib import Path
from urllib.parse import parse_qs, urlparse

# Build paths inside the project like this: BASE_DIR / 'subdir'.
BASE_DIR = Path(__file__).resolve().parent.parent


def _load_local_env(env_path: Path):
    if not env_path.exists():
        return
    for line in env_path.read_text(encoding="utf-8").splitlines():
        striped = line.strip()
        if not striped or striped.startswith("#") or "=" not in striped:
            continue
        key, value = striped.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        os.environ.setdefault(key, value)


def _env_bool(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _env_int(name: str, default: int) -> int:
    value = os.getenv(name)
    if value is None:
        return default
    try:
        return int(value.strip())
    except (TypeError, ValueError):
        return default


def _env_list(name: str, default: str = "") -> list[str]:
    value = os.getenv(name, default)
    return [item.strip() for item in value.split(",") if item.strip()]


def _can_resolve_database_host(database_url: str) -> bool:
    if not database_url:
        return False

    parsed = urlparse(database_url)
    host = parsed.hostname
    if not host:
        return False

    try:
        socket.getaddrinfo(host, parsed.port or 5432, proto=socket.IPPROTO_TCP)
        return True
    except OSError:
        return False


def _select_database_url(direct_database_url: str, pooler_database_url: str) -> str:
    prefer_pooler = _env_bool("DB_PREFER_POOLER", True)
    primary = pooler_database_url if prefer_pooler else direct_database_url
    fallback = direct_database_url if prefer_pooler else pooler_database_url

    if _can_resolve_database_host(primary):
        return primary
    if _can_resolve_database_host(fallback):
        return fallback
    return primary or fallback or ""


_load_local_env(BASE_DIR / ".env")


# Quick-start development settings - unsuitable for production
# See https://docs.djangoproject.com/en/5.2/howto/deployment/checklist/

# SECURITY WARNING: keep the secret key used in production secret!
SECRET_KEY = os.getenv("SECRET_KEY", "replace-me")

# SECURITY WARNING: don't run with debug turned on in production!
DEBUG = _env_bool("DEBUG", True)

ALLOWED_HOSTS = _env_list("ALLOWED_HOSTS", "127.0.0.1,localhost,0.0.0.0,[::1]")
if DEBUG:
    # Dev convenience: allow accessing API from localhost, loopback, or LAN hosts.
    ALLOWED_HOSTS = ["*"]


# Application definition

INSTALLED_APPS = [
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
    'corsheaders',
    'rest_framework',
    'users',
    'tracer',
]

MIDDLEWARE = [
    'django.middleware.security.SecurityMiddleware',
    'corsheaders.middleware.CorsMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
]

ROOT_URLCONF = 'core.urls'

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
            ],
        },
    },
]

WSGI_APPLICATION = 'core.wsgi.application'


AUTH_USER_MODEL = 'users.User'


CORS_ALLOWED_ORIGINS = _env_list(
    "CORS_ALLOWED_ORIGINS",
    "http://localhost:3000,http://localhost:3001,http://127.0.0.1:3000,http://127.0.0.1:3001",
)
CORS_ALLOW_ALL_ORIGINS = _env_bool("CORS_ALLOW_ALL_ORIGINS", DEBUG)
CSRF_TRUSTED_ORIGINS = _env_list(
    "CSRF_TRUSTED_ORIGINS",
    "http://localhost:3000,http://localhost:3001",
)


# Database
# https://docs.djangoproject.com/en/5.2/ref/settings/#databases

DATABASE_POOLER_URL = os.getenv("DATABASE_POOLER_URL") or os.getenv("SUPABASE_POOLER_URL") or ""
DATABASE_DIRECT_URL = os.getenv("DATABASE_URL", "")
DATABASE_URL = _select_database_url(
    direct_database_url=DATABASE_DIRECT_URL,
    pooler_database_url=DATABASE_POOLER_URL,
)

SUPABASE_URL = os.getenv("SUPABASE_URL", "").rstrip("/")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
SUPABASE_STORAGE_BUCKET = os.getenv("SUPABASE_STORAGE_BUCKET", "faceid-verification")

has_placeholder_db_url = (
    DATABASE_URL is not None
    and ("YOUR_PASSWORD" in DATABASE_URL or "YOUR_PROJECT_REF" in DATABASE_URL)
)

if DATABASE_URL and not has_placeholder_db_url:
    parsed = urlparse(DATABASE_URL)
    query_params = parse_qs(parsed.query)
    db_options = {}
    if "sslmode" in query_params:
        db_options["sslmode"] = query_params["sslmode"][0]
    default_conn_max_age = 0 if DEBUG else 600
    conn_max_age = _env_int("DB_CONN_MAX_AGE", default_conn_max_age)

    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.postgresql",
            "NAME": parsed.path.lstrip("/") or "postgres",
            "USER": parsed.username,
            "PASSWORD": parsed.password,
            "HOST": parsed.hostname,
            "PORT": parsed.port or 5432,
            "OPTIONS": db_options,
            "CONN_MAX_AGE": conn_max_age,
            "CONN_HEALTH_CHECKS": True,
            "DISABLE_SERVER_SIDE_CURSORS": True,
        }
    }
else:
    DATABASES = {
        'default': {
            'ENGINE': 'django.db.backends.sqlite3',
            'NAME': BASE_DIR / 'db.sqlite3',
        }
    }


# Password validation
# https://docs.djangoproject.com/en/5.2/ref/settings/#auth-password-validators

AUTH_PASSWORD_VALIDATORS = [
    {
        'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator',
    },
    {
        'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator',
    },
    {
        'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator',
    },
    {
        'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator',
    },
]


# Internationalization
# https://docs.djangoproject.com/en/5.2/topics/i18n/

LANGUAGE_CODE = 'en-us'

TIME_ZONE = 'UTC'

USE_I18N = True

USE_TZ = True


# Static files (CSS, JavaScript, Images)
# https://docs.djangoproject.com/en/5.2/howto/static-files/

STATIC_URL = 'static/'

# Default primary key field type
# https://docs.djangoproject.com/en/5.2/ref/settings/#default-auto-field

DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'
