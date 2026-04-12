@AGENTS.md
Product Requirements Document (PRD)
Project Title: Graduate Tracer System with Predictive Employability Trend Analysis

Target Institution: Carlos Hilado Memorial State University - Talisay Campus

Target Program: BSIS Program

Target Demographics: Alumni batches from 2020 to 2025 (5-year historical data population)

1. Technical Stack Configuration
Frontend: React and Next.js (App Router) for a highly responsive, server-side rendered user interface.

Backend & Database: Supabase (PostgreSQL for relational data, Supabase Auth for role-based access, Supabase Storage for identity verification image retention).

Styling & UI: Tailwind CSS combined with Figma-to-React component methodologies.

Deployment: Vercel (Production) or Docker (if containerization is strictly required for the final defense).

2. User Roles & Access Hierarchy
Verified Alumni (2020-2025): Can update employment records, view predictive industry trends, and manage their geographic footprint.

Employer: A newly introduced role. Can register, verify the employment status of specific alumni, and view aggregated skill trends to aid in recruitment planning.

Administrator (Program Chair/Faculty): Has full access to the geomapping dashboard, predictive analytics engine, and master user management.

3. Core Functional Modules (The "What")
Module A: Enhanced Identity Verification & Geo-Tagging Gate
To ensure absolute data integrity and prevent fraudulent entries, the standard ID verification is reinforced with mandatory visual and spatial validation.

Identity Photo Capture: During initial registration or critical status updates, the system must trigger the device camera to capture a real-time image of the user.

Metadata Encoding: The image capture must be securely stamped with the exact Date, Time, and GPS Coordinates (Latitude/Longitude) of the submission.

Audit Trail Storage: This digital record must be securely uploaded to Supabase Storage and linked to the user's PostgreSQL record for administrative auditing and verification.

Module B: Geographic Distribution (Geomapping)
The system must feature an interactive map rendering the employment locations of BSIS graduates.

Spatial Plotting: Alumni workplace coordinates will be plotted as visual nodes on the map.

Administrative Filtering: Administrators can filter the map by batch year (2020-2025), industry, or current employment status to visualize regional industry concentration or employment migration.

Module C: Employer Interaction Portal
Employers must have a dedicated portal to interact with the university's ecosystem.

Employment Confirmation: Ability to confirm if an alumnus is currently employed at their organization to maintain data accuracy.

Aggregate Skill Insights: Employers can view anonymized, aggregate data regarding the technical skills possessed by recent graduates to assist in talent gap analysis.

Module D: Predictive Employability Trend Analysis
The core analytical engine of the system, utilizing the populated 2020-2025 historical data.

Trend Forecasting: Analysis of the 5-year dataset to identify rising and falling industries for BSIS graduates.

Skill Demand Prediction: Based on the trajectory of alumni roles, the dashboard highlights which technical skills are becoming more prevalent in the workforce.

Time-to-Hire Analytics: Calculating the average duration between graduation and first employment, plotted over the 5-year span to predict future batch performance.

4. Technical Feasibility & Integration Notes
Geomapping Implementation: Next.js can integrate with libraries like react-leaflet or mapbox-gl to render the maps. The GPS coordinates captured during the identity verification step can be directly fed into this map.

Identity Capture: The browser's native MediaDevices.getUserMedia() API will be used within React components to access the camera, while the Geolocation API will simultaneously pull the spatial coordinates.

Predictive Analytics: Since Supabase uses PostgreSQL, advanced SQL window functions and statistical queries can handle the baseline trend analysis directly in the database, ensuring high performance without requiring external data science tools.