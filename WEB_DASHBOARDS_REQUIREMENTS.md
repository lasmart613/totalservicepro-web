# Web Version Dashboard Requirements - Role-Based Views

## Overview
The web version of Total Service Pro must support **role-based dashboards** with proper permissions, extending the existing user role system from the Android app (roles include admin, service_manager, dispatcher, engineer, etc.).

The goal is to provide tailored experiences:
- High-level users (Service Managers, Dispatchers, Business Owners) get operational oversight.
- Low-level users (FSEs) get focused personal tools.
- Dashboards should be the primary landing page after login, driven by the user's role and organization.

## Roles & Capabilities

### Service Manager / Business Owner (High-Level)
- **Full organizational visibility**
- View **all** Tickets across the team
- View **all** Service Reports (draft + submitted)
- View all FSE workflows and activity
- View all Equipment and Customer records
- Access to team-wide KPIs and analytics
- Ability to drill down into any FSE's work
- Overview of operational health

**Key KPIs to surface:**
- Open / In-Progress / Completed Tickets
- Reports submitted this week/month
- Average report completion time
- FSE utilization rate
- Tickets by status (backlog, scheduled, overdue)
- Upcoming maintenance due on equipment

### Dispatcher (Scheduling-Focused)
- **Assignment and scheduling power**
- View Tickets (with emphasis on unassigned and scheduled)
- **Assign FSEs to Tickets**
- **Schedule service calls** (date, time, FSE)
- View FSE calendar / availability / current workload
- See basic status of in-progress work
- Limited view of completed reports (summary level)

**Key KPIs:**
- Unassigned ticket count
- Tickets scheduled today / this week
- FSE workload distribution
- Average time from ticket creation to assignment
- SLA compliance (tickets completed on time)

### FSE (Field Service Engineer) - Personal / Low-Level
- **My Work** focused dashboard
- List of assigned Tickets
- Quick access to create/edit Service Reports for their tickets
- View their own historical reports
- Relevant equipment details for current jobs
- Personal performance metrics

**Key KPIs:**
- My open tickets
- Reports submitted this month
- Average time to complete assigned work
- Upcoming scheduled jobs

## Dashboard UI/UX Requirements
- Role determines which dashboard (or dashboard sections) the user sees.
- Use existing user_profiles.role + organization_id for access control (align with Android/Supabase RLS).
- Modern, clean interface consistent with the rest of the web app (navy/gold branding).
- Responsive (desktop primary, tablet friendly).
- KPI cards at top (clickable where it makes sense to filter lists below).
- Tables/lists with good filtering, search, and sorting.
- Quick action buttons (e.g., "Assign FSE", "Schedule", "Open Report").
- Activity feed or recent items section.
- Calendar view component for Dispatchers and FSEs.

## Technical Alignment
- Build on top of data models discovered from the Android codebase (service_reports, tickets/service_schedule, user_profiles, organizations, equipment).
- Prefer server components or efficient data fetching (e.g. TanStack Query).
- Permission checks on both frontend and backend (Supabase RLS + API layer).
- Consider a shared dashboard component library with role-gated sections.
- Future extensibility for more roles or custom org-level dashboards.

## Implementation Priority
1. Define role-based routing / layout (protected routes or conditional rendering).
2. Build the Service Manager / Owner dashboard (broadest view).
3. Build Dispatcher dashboard with assignment + scheduling UI.
4. Build FSE personal dashboard.
5. Add KPI widgets and data visualization (charts for trends if time allows).
6. Ensure proper data scoping by organization.

Please treat this as a core requirement for the web app architecture and UI planning. Update your todo list and architecture decisions accordingly. Reference the existing Android service_schedule, service_report, and user role logic heavily.
