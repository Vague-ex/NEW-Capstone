from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin

from .models import (
	AdminCredential,
	AlumniAccount,
	EmployerAccount,
	GraduateMasterRecord,
	User,
)


@admin.register(User)
class UserAdmin(BaseUserAdmin):
	ordering = ("email",)
	list_display = ("email", "role", "is_staff", "is_active")
	list_filter = ("role", "is_staff", "is_active")
	fieldsets = (
		(None, {"fields": ("email", "password")}),
		("Role", {"fields": ("role",)}),
		("Permissions", {"fields": ("is_active", "is_staff", "is_superuser", "groups", "user_permissions")}),
		("Important dates", {"fields": ("last_login",)}),
	)
	add_fieldsets = (
		(None, {
			"classes": ("wide",),
			"fields": ("email", "password1", "password2", "role", "is_staff", "is_active"),
		}),
	)
	search_fields = ("email",)


@admin.register(GraduateMasterRecord)
class GraduateMasterRecordAdmin(admin.ModelAdmin):
	list_display = ("student_number", "full_name", "batch_year", "is_active")
	list_filter = ("batch_year", "is_active")
	search_fields = ("student_number", "full_name", "last_name", "email")


@admin.register(AlumniAccount)
class AlumniAccountAdmin(admin.ModelAdmin):
	list_display = ("user", "student_number", "account_status", "created_at")
	list_filter = ("account_status",)
	search_fields = ("user__email", "student_number")


@admin.register(EmployerAccount)
class EmployerAccountAdmin(admin.ModelAdmin):
	list_display = ("company_name", "company_email", "account_status", "created_at")
	list_filter = ("account_status",)
	search_fields = ("company_name", "company_email", "user__email")


@admin.register(AdminCredential)
class AdminCredentialAdmin(admin.ModelAdmin):
	list_display = ("admin_email", "is_active", "created_at")
	list_filter = ("is_active",)
	search_fields = ("admin_email", "user__email")
