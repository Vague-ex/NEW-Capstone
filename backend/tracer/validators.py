"""
Data Validation Framework for Survey Responses

Ensures all survey data is clean before storage and model training.
All inputs MUST be clean data - this framework validates against encoding rules,
field constraints, and logical consistency requirements.

Reference: EyeOfTheTiger/Data_Validation_Rules.md
"""

from datetime import datetime
from enum import Enum
from typing import Dict, List, Optional, Tuple, Any
from django.core.exceptions import ValidationError


class ValidationStatus(Enum):
    """Validation result status"""
    VALID = "valid"
    INVALID = "invalid"
    WARNINGS = "warnings"


class FieldValidationRules:
    """Define validation rules per field based on PredictiveModelContext.md"""

    # Binary Fields
    GENDER_CHOICES = {'M', 'F', 'Male', 'Female'}

    # Ordinal Fields (must be in valid range)
    GPA_RANGE_VALID = {0, 1, 2, 3, 4, 5}  # None allowed separately
    HONORS_VALID = {1, 2, 3, 4}
    OJT_RELEVANCE_VALID = {0, 1, 2, 3}
    ENGLISH_PROFICIENCY_VALID = {1, 2, 3}
    JOB_APPLICATIONS_VALID = {1, 2, 3, 4}

    # Categorical Fields
    JOB_SECTOR_VALID = {'government', 'private', 'entrepreneurial'}
    JOB_STATUS_VALID = {'regular', 'probationary', 'contractual', 'self_employed'}
    JOB_SOURCE_VALID = {
        'personal_network', 'online_portal', 'career_fair', 'walk_in',
        'social_media', 'entrepreneurship', 'other'
    }
    EMPLOYMENT_STATUS_VALID = {
        'employed_full_time', 'employed_part_time', 'self_employed',
        'seeking', 'not_seeking', 'never_employed'
    }

    # Continuous/Range Fields
    TIME_TO_HIRE_VALID = {1, 3, 4.5, 9, 18, 30}
    COHORT_RANGE = (2020, 2025)
    AGE_RANGE = (18, 70)

    # Count Ranges
    TECHNICAL_SKILL_COUNT_RANGE = (0, 12)
    SOFT_SKILL_COUNT_RANGE = (0, 10)

    # Philippines Regions
    REGIONS_VALID = {
        'NCR', 'Region I', 'Region II', 'Region III', 'Region IV-A', 'Region IV-B',
        'Region V', 'Region VI', 'Region VII', 'Region VIII', 'Region IX', 'Region X',
        'Region XI', 'Region XII', 'Region XIII', 'CAR', 'BARMM', 'Abroad'
    }


class SurveyDataValidator:
    """Comprehensive survey data validation"""

    def __init__(self):
        self.errors: List[Dict[str, Any]] = []
        self.warnings: List[Dict[str, Any]] = []
        self.field_completeness: Dict[str, bool] = {}

    def validate_comprehensive_survey(self, survey_data: Dict) -> Dict:
        """
        Validate complete survey response

        Args:
            survey_data: Dictionary containing all survey sections

        Returns:
            Validation result with status, errors, warnings, completeness score
        """
        self.errors = []
        self.warnings = []
        self.field_completeness = {}

        # Validate personal information section
        if 'personal_information' in survey_data:
            self._validate_personal_info(survey_data['personal_information'])

        # Validate educational background
        if 'educational_background' in survey_data:
            self._validate_educational_background(survey_data['educational_background'])

        # Validate academic & pre-employment
        if 'academic_preemployment' in survey_data:
            self._validate_academic_preemployment(survey_data['academic_preemployment'])

        # Validate employment status
        if 'employment_status' in survey_data:
            self._validate_employment_status(survey_data['employment_status'])

        # Validate first job details
        if 'first_job_details' in survey_data:
            self._validate_first_job_details(survey_data['first_job_details'])

        # Validate current job details
        if 'current_job_details' in survey_data:
            self._validate_current_job_details(survey_data['current_job_details'])

        # Validate work address
        if 'work_address' in survey_data:
            self._validate_work_address(survey_data['work_address'])

        # Validate competency assessment
        if 'competency_assessment' in survey_data:
            self._validate_competency_assessment(survey_data['competency_assessment'])

        # Validate logical consistency across sections
        self._validate_consistency(survey_data)

        # Calculate metrics
        status = self._determine_status()
        completeness = self._calculate_completeness(survey_data)

        return {
            'status': status.value,
            'is_valid': len(self.errors) == 0,
            'completeness_score': completeness,
            'errors': self.errors,
            'warnings': self.warnings,
            'field_completeness': self.field_completeness
        }

    def _validate_personal_info(self, data: Dict):
        """Validate personal information fields"""
        required_fields = ['first_name', 'last_name', 'gender', 'birth_date', 'mobile', 'city', 'province']

        for field in required_fields:
            if not data.get(field):
                self.errors.append({
                    'section': 'personal_information',
                    'field': field,
                    'error': f'{field} is required'
                })
            else:
                self.field_completeness[field] = True

        # Validate gender
        if data.get('gender') and data['gender'].upper() not in {g.upper() for g in FieldValidationRules.GENDER_CHOICES}:
            self.errors.append({
                'section': 'personal_information',
                'field': 'gender',
                'error': f"Invalid gender: {data['gender']}"
            })

        # Validate birth date format and age
        if data.get('birth_date'):
            try:
                birth_date = datetime.fromisoformat(data['birth_date']).date() if isinstance(data['birth_date'], str) else data['birth_date']
                age = (datetime.now().date() - birth_date).days // 365
                if not (FieldValidationRules.AGE_RANGE[0] <= age <= FieldValidationRules.AGE_RANGE[1]):
                    self.warnings.append({
                        'section': 'personal_information',
                        'field': 'birth_date',
                        'warning': f'Age {age} outside typical range {FieldValidationRules.AGE_RANGE}'
                    })
            except (ValueError, AttributeError):
                self.errors.append({
                    'section': 'personal_information',
                    'field': 'birth_date',
                    'error': 'Invalid date format. Use YYYY-MM-DD'
                })

        # Validate mobile format (basic check)
        if data.get('mobile') and not (len(data['mobile']) >= 10):
            self.errors.append({
                'section': 'personal_information',
                'field': 'mobile',
                'error': 'Mobile number too short'
            })

    def _validate_educational_background(self, data: Dict):
        """Validate educational background fields"""
        required_fields = ['graduation_date', 'graduation_year']

        for field in required_fields:
            if not data.get(field):
                self.errors.append({
                    'section': 'educational_background',
                    'field': field,
                    'error': f'{field} is required'
                })
            else:
                self.field_completeness[field] = True

        # Validate graduation year range
        if data.get('graduation_year'):
            try:
                year = int(data['graduation_year'])
                if not (FieldValidationRules.COHORT_RANGE[0] <= year <= FieldValidationRules.COHORT_RANGE[1]):
                    self.errors.append({
                        'section': 'educational_background',
                        'field': 'graduation_year',
                        'error': f'Year {year} outside valid range {FieldValidationRules.COHORT_RANGE}'
                    })
            except (ValueError, TypeError):
                self.errors.append({
                    'section': 'educational_background',
                    'field': 'graduation_year',
                    'error': 'Invalid year format'
                })

    def _validate_academic_preemployment(self, data: Dict):
        """Validate academic & pre-employment profile fields"""

        # Validate GPA range
        if data.get('general_average_range') is not None:
            if data['general_average_range'] not in FieldValidationRules.GPA_RANGE_VALID:
                self.errors.append({
                    'section': 'academic_preemployment',
                    'field': 'general_average_range',
                    'error': f"GPA range {data['general_average_range']} not in valid set {FieldValidationRules.GPA_RANGE_VALID}"
                })
            else:
                self.field_completeness['general_average_range'] = True

        # Validate academic honors
        if data.get('academic_honors') is not None:
            if data['academic_honors'] not in FieldValidationRules.HONORS_VALID:
                self.errors.append({
                    'section': 'academic_preemployment',
                    'field': 'academic_honors',
                    'error': f"Academic honors {data['academic_honors']} not in valid set {FieldValidationRules.HONORS_VALID}"
                })
            else:
                self.field_completeness['academic_honors'] = True

        # Validate OJT relevance
        if data.get('ojt_relevance') is not None:
            if data['ojt_relevance'] not in FieldValidationRules.OJT_RELEVANCE_VALID:
                self.errors.append({
                    'section': 'academic_preemployment',
                    'field': 'ojt_relevance',
                    'error': f"OJT relevance {data['ojt_relevance']} not in valid set {FieldValidationRules.OJT_RELEVANCE_VALID}"
                })
            else:
                self.field_completeness['ojt_relevance'] = True

        # Validate English proficiency
        if data.get('english_proficiency') is not None:
            if data['english_proficiency'] not in FieldValidationRules.ENGLISH_PROFICIENCY_VALID:
                self.errors.append({
                    'section': 'academic_preemployment',
                    'field': 'english_proficiency',
                    'error': f"English proficiency {data['english_proficiency']} not in valid set {FieldValidationRules.ENGLISH_PROFICIENCY_VALID}"
                })
            else:
                self.field_completeness['english_proficiency'] = True

    def _validate_employment_status(self, data: Dict):
        """Validate employment status"""
        if data.get('employment_status'):
            if data['employment_status'] not in FieldValidationRules.EMPLOYMENT_STATUS_VALID:
                self.errors.append({
                    'section': 'employment_status',
                    'field': 'employment_status',
                    'error': f"Status {data['employment_status']} not in valid choices"
                })
            else:
                self.field_completeness['employment_status'] = True
        else:
            self.errors.append({
                'section': 'employment_status',
                'field': 'employment_status',
                'error': 'Employment status is required'
            })

    def _validate_first_job_details(self, data: Dict):
        """Validate first job details"""

        # Validate time-to-hire
        if data.get('time_to_hire_months') is not None:
            if data['time_to_hire_months'] not in FieldValidationRules.TIME_TO_HIRE_VALID:
                self.errors.append({
                    'section': 'first_job_details',
                    'field': 'time_to_hire_months',
                    'error': f"Time-to-hire {data['time_to_hire_months']} not in valid set {FieldValidationRules.TIME_TO_HIRE_VALID}"
                })
            else:
                self.field_completeness['time_to_hire_months'] = True

        # Validate first job sector
        if data.get('first_job_sector') is not None:
            if data['first_job_sector'] not in FieldValidationRules.JOB_SECTOR_VALID:
                self.errors.append({
                    'section': 'first_job_details',
                    'field': 'first_job_sector',
                    'error': f"Sector {data['first_job_sector']} not in valid choices"
                })
            else:
                self.field_completeness['first_job_sector'] = True

        # Validate first job status
        if data.get('first_job_status') is not None:
            if data['first_job_status'] not in FieldValidationRules.JOB_STATUS_VALID:
                self.errors.append({
                    'section': 'first_job_details',
                    'field': 'first_job_status',
                    'error': f"Status {data['first_job_status']} not in valid choices"
                })
            else:
                self.field_completeness['first_job_status'] = True

        # Validate job application count
        if data.get('first_job_applications_count') is not None:
            if data['first_job_applications_count'] not in FieldValidationRules.JOB_APPLICATIONS_VALID:
                self.errors.append({
                    'section': 'first_job_details',
                    'field': 'first_job_applications_count',
                    'error': f"Application count {data['first_job_applications_count']} not in valid set {FieldValidationRules.JOB_APPLICATIONS_VALID}"
                })
            else:
                self.field_completeness['first_job_applications_count'] = True

        # Validate job source
        if data.get('first_job_source') is not None:
            if data['first_job_source'] not in FieldValidationRules.JOB_SOURCE_VALID:
                self.errors.append({
                    'section': 'first_job_details',
                    'field': 'first_job_source',
                    'error': f"Job source {data['first_job_source']} not in valid choices"
                })
            else:
                self.field_completeness['first_job_source'] = True

    def _validate_current_job_details(self, data: Dict):
        """Validate current/most recent job details"""

        if data.get('current_job_sector') is not None:
            if data['current_job_sector'] not in FieldValidationRules.JOB_SECTOR_VALID:
                self.errors.append({
                    'section': 'current_job_details',
                    'field': 'current_job_sector',
                    'error': f"Sector {data['current_job_sector']} not in valid choices"
                })
            else:
                self.field_completeness['current_job_sector'] = True

        if data.get('location_type') is not None:
            if not isinstance(data['location_type'], bool):
                self.errors.append({
                    'section': 'current_job_details',
                    'field': 'location_type',
                    'error': 'Location type must be boolean (True=Local, False=Abroad)'
                })
            else:
                self.field_completeness['location_type'] = True

    def _validate_work_address(self, data: Dict):
        """Validate work address fields"""
        required_fields = ['city_municipality', 'province', 'region']

        for field in required_fields:
            if not data.get(field):
                self.errors.append({
                    'section': 'work_address',
                    'field': field,
                    'error': f'{field} is required'
                })
            else:
                self.field_completeness[field] = True

        # Validate region
        if data.get('region') and data['region'] not in FieldValidationRules.REGIONS_VALID:
            self.errors.append({
                'section': 'work_address',
                'field': 'region',
                'error': f"Region {data['region']} not in valid set"
            })

        # Validate coordinates if provided
        if data.get('latitude') is not None:
            try:
                lat = float(data['latitude'])
                if not (-90 <= lat <= 90):
                    self.errors.append({
                        'section': 'work_address',
                        'field': 'latitude',
                        'error': f'Latitude {lat} outside valid range [-90, 90]'
                    })
            except (ValueError, TypeError):
                self.errors.append({
                    'section': 'work_address',
                    'field': 'latitude',
                    'error': 'Latitude must be numeric'
                })

        if data.get('longitude') is not None:
            try:
                lng = float(data['longitude'])
                if not (-180 <= lng <= 180):
                    self.errors.append({
                        'section': 'work_address',
                        'field': 'longitude',
                        'error': f'Longitude {lng} outside valid range [-180, 180]'
                    })
            except (ValueError, TypeError):
                self.errors.append({
                    'section': 'work_address',
                    'field': 'longitude',
                    'error': 'Longitude must be numeric'
                })

    def _validate_competency_assessment(self, data: Dict):
        """Validate competency assessment"""

        # Validate technical skill count
        if data.get('technical_skill_count') is not None:
            count = data['technical_skill_count']
            min_val, max_val = FieldValidationRules.TECHNICAL_SKILL_COUNT_RANGE
            if not (min_val <= count <= max_val):
                self.errors.append({
                    'section': 'competency_assessment',
                    'field': 'technical_skill_count',
                    'error': f'Technical skill count {count} outside valid range [{min_val}, {max_val}]'
                })
            else:
                self.field_completeness['technical_skill_count'] = True

        # Validate soft skill count
        if data.get('soft_skill_count') is not None:
            count = data['soft_skill_count']
            min_val, max_val = FieldValidationRules.SOFT_SKILL_COUNT_RANGE
            if not (min_val <= count <= max_val):
                self.errors.append({
                    'section': 'competency_assessment',
                    'field': 'soft_skill_count',
                    'error': f'Soft skill count {count} outside valid range [{min_val}, {max_val}]'
                })
            else:
                self.field_completeness['soft_skill_count'] = True

    def _validate_consistency(self, survey_data: Dict):
        """Validate logical consistency across sections"""

        employment_status = survey_data.get('employment_status', {}).get('employment_status')
        first_job = survey_data.get('first_job_details', {})
        time_to_hire = first_job.get('time_to_hire_months')

        # Consistency rule 1: Unemployed but has time-to-hire
        if employment_status in ['seeking', 'not_seeking', 'never_employed']:
            if time_to_hire is not None:
                self.errors.append({
                    'consistency': True,
                    'error': f'Employment status "{employment_status}" but time_to_hire is {time_to_hire} (should be NULL)'
                })

        # Consistency rule 2: Employed but no time-to-hire
        if employment_status in ['employed_full_time', 'employed_part_time', 'self_employed']:
            if time_to_hire is None:
                self.warnings.append({
                    'consistency': True,
                    'warning': f'Employment status "{employment_status}" but no time_to_hire recorded'
                })

        # Consistency rule 3: Birth date before graduation date
        personal_info = survey_data.get('personal_information', {})
        educational_bg = survey_data.get('educational_background', {})

        if personal_info.get('birth_date') and educational_bg.get('graduation_date'):
            try:
                birth = datetime.fromisoformat(personal_info['birth_date']).date() if isinstance(personal_info['birth_date'], str) else personal_info['birth_date']
                grad = datetime.fromisoformat(educational_bg['graduation_date']).date() if isinstance(educational_bg['graduation_date'], str) else educational_bg['graduation_date']
                if birth >= grad:
                    self.errors.append({
                        'consistency': True,
                        'error': 'Birth date must be before graduation date'
                    })
            except (ValueError, AttributeError):
                pass  # Date validation already handled

    def _determine_status(self) -> ValidationStatus:
        """Determine overall validation status"""
        if self.errors:
            return ValidationStatus.INVALID
        elif self.warnings:
            return ValidationStatus.WARNINGS
        else:
            return ValidationStatus.VALID

    def _calculate_completeness(self, survey_data: Dict) -> float:
        """Calculate data completeness percentage"""
        total_sections = len(survey_data)
        if total_sections == 0:
            return 0.0

        completed_fields = sum(1 for v in self.field_completeness.values() if v)
        return min(100.0, (completed_fields / total_sections) * 100)


def validate_survey_data(func):
    """
    Decorator to validate survey data before processing

    Usage:
        @validate_survey_data
        def handle_survey_submission(request):
            # request.data is guaranteed to be valid
    """
    def wrapper(request, *args, **kwargs):
        from rest_framework.response import Response
        from rest_framework import status

        validator = SurveyDataValidator()
        result = validator.validate_comprehensive_survey(request.data)

        if not result['is_valid']:
            return Response(result, status=status.HTTP_400_BAD_REQUEST)

        # Add validation result to request for reference
        request.validation_result = result
        return func(request, *args, **kwargs)

    return wrapper
