from django.contrib import admin

from .models import (
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


@admin.register(Industry)
class IndustryAdmin(admin.ModelAdmin):
	list_display = ("name", "is_active")
	list_filter = ("is_active",)
	search_fields = ("name",)


@admin.register(JobTitle)
class JobTitleAdmin(admin.ModelAdmin):
	list_display = ("name", "industry", "is_active")
	list_filter = ("industry", "is_active")
	search_fields = ("name",)


@admin.register(SkillCategory)
class SkillCategoryAdmin(admin.ModelAdmin):
	list_display = ("name", "is_active")
	list_filter = ("is_active",)
	search_fields = ("name",)


@admin.register(Skill)
class SkillAdmin(admin.ModelAdmin):
	list_display = ("name", "category", "is_active")
	list_filter = ("category", "is_active")
	search_fields = ("name",)


@admin.register(Region)
class RegionAdmin(admin.ModelAdmin):
	list_display = ("code", "name", "is_active")
	list_filter = ("is_active",)
	search_fields = ("code", "name")


@admin.register(EmploymentRecord)
class EmploymentRecordAdmin(admin.ModelAdmin):
	list_display = (
		"alumni",
		"employer_name_input",
		"employment_status",
		"verification_status",
		"is_current",
		"created_at",
	)
	list_filter = ("employment_status", "verification_status", "is_current")
	search_fields = ("alumni__user__email", "alumni__master_record__full_name", "employer_name_input", "job_title_input")


@admin.register(AlumniSkill)
class AlumniSkillAdmin(admin.ModelAdmin):
	list_display = ("alumni", "skill", "proficiency_level", "updated_at")
	list_filter = ("proficiency_level",)
	search_fields = ("alumni__user__email", "alumni__master_record__full_name", "skill__name")


@admin.register(VerificationToken)
class VerificationTokenAdmin(admin.ModelAdmin):
	list_display = ("token_id", "alumni", "status", "expires_at", "used_at")
	list_filter = ("status",)
	search_fields = ("alumni__user__email", "alumni__master_record__full_name")


@admin.register(VerificationDecision)
class VerificationDecisionAdmin(admin.ModelAdmin):
	list_display = ("token", "employer_account", "verified_employer_name", "decision", "decided_at")
	list_filter = ("decision",)
	search_fields = ("token__employment_record__alumni__user__email", "employer_account__company_name", "verified_employer_name")
