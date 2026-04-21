"""
Serializers for survey data and analytics endpoints

Handles validation and serialization of:
- Comprehensive survey submissions (8 sections)
- Employment profile data
- Work address information
- Competency assessments
- Analytics predictions
- Training data exports
"""

from rest_framework import serializers
from users.models import AlumniProfile, AlumniAccount
from tracer.models import (
    EmploymentProfile, WorkAddress, CompetencyProfile,
    EmploymentRecord, AlumniSkill, Skill
)


class PersonalInformationSerializer(serializers.Serializer):
    """Section 1: Personal Information"""

    first_name = serializers.CharField(max_length=100, required=True)
    middle_name = serializers.CharField(max_length=100, required=False, allow_blank=True)
    last_name = serializers.CharField(max_length=100, required=True)
    gender = serializers.ChoiceField(choices=['M', 'F', 'Male', 'Female'], required=True)
    birth_date = serializers.DateField(required=True)
    civil_status = serializers.CharField(max_length=50, required=False, allow_blank=True)
    mobile = serializers.CharField(max_length=20, required=True)
    email = serializers.EmailField(required=False, allow_blank=True)
    facebook_url = serializers.URLField(required=False, allow_blank=True)
    city = serializers.CharField(max_length=120, required=True)
    province = serializers.CharField(max_length=120, required=True)

    def validate_birth_date(self, value):
        """Validate birth date is reasonable"""
        from datetime import date
        today = date.today()
        age = (today - value).days // 365
        if age < 18 or age > 70:
            raise serializers.ValidationError(f"Age {age} outside typical range (18-70)")
        return value


class EducationalBackgroundSerializer(serializers.Serializer):
    """Section 2: Educational Background"""

    graduation_date = serializers.DateField(required=True)
    graduation_year = serializers.IntegerField(required=True, min_value=2020, max_value=2025)
    scholarship = serializers.CharField(max_length=255, required=False, allow_blank=True)
    highest_attainment = serializers.ChoiceField(
        choices=['NA', 'Graduate', 'PostGrad', 'Doctorate'],
        required=False,
        allow_blank=True
    )
    graduate_school = serializers.CharField(max_length=255, required=False, allow_blank=True)
    professional_eligibility = serializers.CharField(max_length=255, required=False, allow_blank=True)

    def validate(self, data):
        """Validate education coherence"""
        if data.get('highest_attainment') in ['PostGrad', 'Doctorate']:
            if not data.get('graduate_school'):
                raise serializers.ValidationError("Graduate school required for post-graduate degrees")
        return data


class AcademicPreEmploymentSerializer(serializers.Serializer):
    """Section 3: Academic & Pre-Employment Profile"""

    general_average_range = serializers.IntegerField(
        required=False,
        allow_null=True,
        min_value=0,
        max_value=5,
        help_text="0=<75, 1=75-79, 2=80-84, 3=85-89, 4=90-94, 5=95-100"
    )
    academic_honors = serializers.IntegerField(
        required=False,
        allow_null=True,
        min_value=1,
        max_value=4,
        help_text="1=None, 2=Cum Laude, 3=Magna Cum Laude, 4=Summa Cum Laude"
    )
    prior_work_experience = serializers.BooleanField(required=False, default=False)
    ojt_relevance = serializers.IntegerField(
        required=False,
        allow_null=True,
        min_value=0,
        max_value=3,
        help_text="0=N/A, 1=Not related, 2=Somewhat, 3=Directly related"
    )
    has_portfolio = serializers.BooleanField(required=False, default=False)
    english_proficiency = serializers.IntegerField(
        required=False,
        allow_null=True,
        min_value=1,
        max_value=3,
        help_text="1=Basic, 2=Conversational, 3=Professional"
    )


class EmploymentStatusSerializer(serializers.Serializer):
    """Section 4: Current Employment Status"""

    EMPLOYMENT_CHOICES = [
        ('employed_full_time', 'Employed Full-Time'),
        ('employed_part_time', 'Employed Part-Time'),
        ('self_employed', 'Self-Employed/Freelance'),
        ('seeking', 'Seeking Employment'),
        ('not_seeking', 'Not Seeking Employment'),
        ('never_employed', 'Never Employed'),
    ]

    employment_status = serializers.ChoiceField(choices=EMPLOYMENT_CHOICES, required=True)


class FirstJobDetailsSerializer(serializers.Serializer):
    """Section 5: First Job Details"""

    time_to_hire_raw = serializers.CharField(max_length=50, required=False, allow_blank=True)
    time_to_hire_months = serializers.FloatField(required=False, allow_null=True)
    first_job_sector = serializers.ChoiceField(
        choices=['government', 'private', 'entrepreneurial'],
        required=False,
        allow_blank=True,
        allow_null=True
    )
    first_job_status = serializers.ChoiceField(
        choices=['regular', 'probationary', 'contractual', 'self_employed'],
        required=False,
        allow_blank=True,
        allow_null=True
    )
    first_job_title = serializers.CharField(max_length=150, required=False, allow_blank=True, allow_null=True)
    first_job_related_to_bsis = serializers.BooleanField(required=False, allow_null=True)
    first_job_unrelated_reason = serializers.CharField(max_length=200, required=False, allow_blank=True, allow_null=True)
    first_job_duration_months = serializers.IntegerField(required=False, allow_null=True, min_value=0)
    first_job_applications_count = serializers.IntegerField(
        required=False,
        allow_null=True,
        min_value=1,
        max_value=4,
        help_text="1=1-5 apps, 2=6-15, 3=16-30, 4=31+"
    )
    first_job_source = serializers.ChoiceField(
        choices=['personal_network', 'online_portal', 'career_fair', 'walk_in', 'social_media', 'entrepreneurship', 'other'],
        required=False,
        allow_blank=True,
        allow_null=True
    )

    def validate_time_to_hire_months(self, value):
        """Validate time-to-hire is one of allowed values"""
        VALID_VALUES = {1, 3, 4.5, 9, 18, 30}
        if value is not None and value not in VALID_VALUES:
            raise serializers.ValidationError(f"Time-to-hire must be one of {VALID_VALUES}")
        return value


class CurrentJobDetailsSerializer(serializers.Serializer):
    """Section 6: Current/Most Recent Job"""

    current_job_sector = serializers.ChoiceField(
        choices=['government', 'private', 'entrepreneurial'],
        required=False,
        allow_blank=True,
        allow_null=True
    )
    current_job_title = serializers.CharField(max_length=150, required=False, allow_blank=True, allow_null=True)
    current_job_company = serializers.CharField(max_length=200, required=False, allow_blank=True, allow_null=True)
    current_job_related_to_bsis = serializers.BooleanField(required=False, allow_null=True)
    location_type = serializers.BooleanField(required=False, allow_null=True, help_text="True=Local, False=Abroad")


class WorkAddressSerializer(serializers.Serializer):
    """Section 7: Work Address for Mapping"""

    REGION_CHOICES = [
        ('NCR', 'NCR'),
        ('Region I', 'Region I (Ilocos)'),
        ('Region II', 'Region II (Cagayan Valley)'),
        ('Region III', 'Region III (Central Luzon)'),
        ('Region IV-A', 'Region IV-A (CALABARZON)'),
        ('Region IV-B', 'Region IV-B (MIMAROPA)'),
        ('Region V', 'Region V (Bicol)'),
        ('Region VI', 'Region VI (Western Visayas)'),
        ('Region VII', 'Region VII (Central Visayas)'),
        ('Region VIII', 'Region VIII (Eastern Visayas)'),
        ('Region IX', 'Region IX (Zamboanga Peninsula)'),
        ('Region X', 'Region X (Northern Mindanao)'),
        ('Region XI', 'Region XI (Davao)'),
        ('Region XII', 'Region XII (SOCCSKSARGEN)'),
        ('Region XIII', 'Region XIII (Caraga)'),
        ('CAR', 'CAR (Cordillera)'),
        ('BARMM', 'BARMM'),
        ('Abroad', 'Abroad/International'),
    ]

    street_address = serializers.CharField(max_length=200, required=False, allow_blank=True)
    barangay = serializers.CharField(max_length=100, required=False, allow_blank=True)
    city_municipality = serializers.CharField(max_length=100, required=True)
    province = serializers.CharField(max_length=100, required=True)
    region = serializers.ChoiceField(choices=REGION_CHOICES, required=True)
    zip_code = serializers.CharField(max_length=20, required=False, allow_blank=True)
    country = serializers.CharField(max_length=100, default='Philippines')
    latitude = serializers.FloatField(required=False, allow_null=True, min_value=-90, max_value=90)
    longitude = serializers.FloatField(required=False, allow_null=True, min_value=-180, max_value=180)


class CompetencyAssessmentSerializer(serializers.Serializer):
    """Section 8: Competency & Skills Assessment"""

    technical_skills = serializers.JSONField(required=False, default=list)
    soft_skills = serializers.JSONField(required=False, default=list)
    technical_skill_count = serializers.IntegerField(required=False, default=0, min_value=0, max_value=12)
    soft_skill_count = serializers.IntegerField(required=False, default=0, min_value=0, max_value=10)
    professional_certifications = serializers.CharField(max_length=500, required=False, allow_blank=True)


class ComprehensiveSurveySerializer(serializers.Serializer):
    """
    Complete survey submission - all 8 sections

    Used for comprehensive alumni survey submission endpoint
    """

    personal_information = PersonalInformationSerializer(required=True)
    educational_background = EducationalBackgroundSerializer(required=True)
    academic_preemployment = AcademicPreEmploymentSerializer(required=False)
    employment_status = EmploymentStatusSerializer(required=True)
    first_job_details = FirstJobDetailsSerializer(required=False)
    current_job_details = CurrentJobDetailsSerializer(required=False)
    work_address = WorkAddressSerializer(required=True)
    competency_assessment = CompetencyAssessmentSerializer(required=False)

    def validate(self, data):
        """Cross-section validation logic"""
        employment_status = data.get('employment_status', {}).get('employment_status')
        first_job = data.get('first_job_details', {})
        time_to_hire = first_job.get('time_to_hire_months')

        # Rule 1: Unemployed/never employed cannot have time-to-hire
        if employment_status in ['seeking', 'not_seeking', 'never_employed']:
            if time_to_hire is not None:
                raise serializers.ValidationError(
                    f'Employment status "{employment_status}" but time_to_hire is {time_to_hire} (should be NULL)'
                )

        # Rule 2: Employed must have time-to-hire (warning if missing)
        if employment_status in ['employed_full_time', 'employed_part_time', 'self_employed']:
            if time_to_hire is None:
                pass  # This becomes a warning, not an error

        return data


class EmploymentProfileDetailSerializer(serializers.ModelSerializer):
    """Detailed employment profile serializer"""

    class Meta:
        model = EmploymentProfile
        fields = [
            'id', 'alumni', 'employment_status', 'time_to_hire_months',
            'first_job_sector', 'first_job_status', 'first_job_title',
            'first_job_related_to_bsis', 'current_job_sector', 'current_job_title',
            'location_type', 'created_at', 'updated_at'
        ]
        read_only_fields = ['id', 'created_at', 'updated_at']


class WorkAddressDetailSerializer(serializers.ModelSerializer):
    """Detailed work address serializer"""

    class Meta:
        model = WorkAddress
        fields = [
            'id', 'alumni', 'city_municipality', 'province', 'region',
            'country', 'latitude', 'longitude', 'is_current', 'created_at'
        ]
        read_only_fields = ['id', 'created_at']


class CompetencyProfileDetailSerializer(serializers.ModelSerializer):
    """Detailed competency profile serializer"""

    class Meta:
        model = CompetencyProfile
        fields = [
            'id', 'alumni', 'technical_skills', 'soft_skills',
            'technical_skill_count', 'soft_skill_count',
            'professional_certifications', 'assessment_date'
        ]
        read_only_fields = ['id', 'assessment_date']


class SurveyDataRetrievalSerializer(serializers.Serializer):
    """Response serializer for survey data retrieval"""

    completion_status = serializers.CharField()
    last_updated = serializers.DateTimeField()
    sections_completed = serializers.ListField(child=serializers.CharField())
    data = serializers.JSONField()


class PredictionDataSerializer(serializers.Serializer):
    """Response serializer for model predictions"""

    cohort = serializers.IntegerField()
    sample_size = serializers.IntegerField()
    employment_rate_percent = serializers.FloatField()
    avg_time_to_hire_months = serializers.FloatField()
    time_to_hire_distribution = serializers.JSONField()
    top_technical_skills = serializers.JSONField()
    bsis_alignment_rate_first_job = serializers.FloatField()
    bsis_alignment_rate_current = serializers.FloatField()
    confidence_intervals = serializers.JSONField()
    model_metadata = serializers.JSONField()
    timestamp = serializers.DateTimeField()


class DataQualityReportSerializer(serializers.Serializer):
    """Response serializer for data quality report"""

    total_surveys = serializers.IntegerField()
    valid_surveys = serializers.IntegerField()
    validity_rate = serializers.FloatField()
    avg_completeness = serializers.FloatField()
    field_error_summary = serializers.JSONField()
    consistency_rate = serializers.FloatField()
    recommendations = serializers.ListField(child=serializers.CharField())


class TrainingDataRowSerializer(serializers.Serializer):
    """Single row of training data for export"""

    alumni_id = serializers.CharField()
    cohort = serializers.IntegerField()
    gender = serializers.IntegerField()
    scholarship = serializers.IntegerField()
    general_average_range = serializers.IntegerField(allow_null=True)
    academic_honors = serializers.IntegerField(allow_null=True)
    prior_work_experience = serializers.IntegerField()
    ojt_relevance = serializers.IntegerField(allow_null=True)
    has_portfolio = serializers.IntegerField()
    english_proficiency = serializers.IntegerField(allow_null=True)
    job_applications_count = serializers.IntegerField(allow_null=True)
    job_source = serializers.IntegerField(allow_null=True)
    first_job_sector = serializers.IntegerField(allow_null=True)
    first_job_status = serializers.IntegerField(allow_null=True)
    technical_skill_count = serializers.IntegerField()
    soft_skill_count = serializers.IntegerField()
    location_type = serializers.IntegerField(allow_null=True)
    current_job_sector = serializers.IntegerField(allow_null=True)
    # Target variables
    time_to_hire_months = serializers.FloatField(allow_null=True)
    employment_status = serializers.IntegerField()
    bsis_related_job_first = serializers.IntegerField()
    bsis_related_job_current = serializers.IntegerField()
    data_quality_score = serializers.FloatField()
