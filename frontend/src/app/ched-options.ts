/**
 * Option lists that come straight off the CHED Graduate Tracer Study form.
 *
 * Shared by registration and the alumni employment edit page so the two can
 * never drift apart in wording. Values match EmploymentProfile's
 * JobStatusChoices / NatureOfBusinessChoices keys and are sent as-is — no
 * label-to-key mapper on submit.
 */

/** CHED Q18: Present Employment Status. */
export const JOB_STATUS_OPTIONS = [
  { label: 'Regular / Permanent', value: 'regular' },
  { label: 'Probationary', value: 'probationary' },
  { label: 'Contractual / Casual', value: 'contractual' },
  { label: 'Self-Employed / Freelance', value: 'self_employed' },
];

/**
 * CHED Q20b: major line of business of the current employer.
 *
 * The 17 CHED options are verbatim. "Information and Communication" is an
 * addition (PSIC 2019 Section J), because PSIC 1992 files software and BPO
 * work under "Real Estate, Renting and Business Activities".
 */
export const NATURE_OF_BUSINESS_OPTIONS = [
  { label: 'Agriculture, Hunting and Forestry', value: 'agriculture_forestry' },
  { label: 'Fishing', value: 'fishing' },
  { label: 'Mining and Quarrying', value: 'mining_quarrying' },
  { label: 'Manufacturing', value: 'manufacturing' },
  { label: 'Electricity, Gas and Water Supply', value: 'electricity_gas_water' },
  { label: 'Construction', value: 'construction' },
  { label: 'Wholesale and Retail Trade', value: 'wholesale_retail' },
  { label: 'Hotels and Restaurants', value: 'hotels_restaurants' },
  { label: 'Transport, Storage and Communication', value: 'transport_communication' },
  { label: 'Financial Intermediation', value: 'financial_intermediation' },
  { label: 'Information and Communication (IT/BPO/Software)', value: 'information_communication' },
  { label: 'Real Estate, Renting and Business Activities', value: 'real_estate_business' },
  { label: 'Public Administration and Defense; Compulsory Social Security', value: 'public_administration' },
  { label: 'Education', value: 'education' },
  { label: 'Health and Social Work', value: 'health_social_work' },
  { label: 'Other Community, Social and Personal Service Activities', value: 'community_social_personal' },
  { label: 'Private Households with Employed Persons', value: 'private_households' },
  { label: 'Extra-territorial Organizations and Bodies', value: 'extraterritorial' },
  { label: 'Other', value: 'other' },
];
