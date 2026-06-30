# Components

React components organized by feature area for the OpenGander dashboard and web application.

## Contents

- `analytics/` - Chart and visualization components for dashboard pages
  - `OverviewStats.tsx` - Summary stat cards (visitors, pageviews, sessions)
  - `PageViewsChart.tsx` - Page view time series chart
  - `TopPagesTable.tsx` - Most visited pages table
  - `CoreWebVitalsGauge.tsx` - Web Vitals gauge components
  - `WebVitalsDistribution.tsx` - Web Vitals distribution charts
  - `TrafficSourcesChart.tsx` - Source/medium breakdown chart
  - `ConversionFunnel.tsx` - Funnel visualization
  - `FunnelFilterPanel.tsx` / `FunnelSegmentPopup.tsx` - Funnel filtering UI
  - `UserJourneySankey.tsx` - Sankey diagram for user flows
  - `PathAnalysis.tsx` / `SessionExplorer.tsx` / `TimeOnPageChart.tsx` - Journey analysis
  - `CampaignPerformance.tsx` - Campaign metrics
  - `ErrorsTable.tsx` - Error log display
  - `MetricComparison.tsx` - Period-over-period comparison
  - `DiscrepancyChart.tsx` / `ValidationInsights.tsx` / `ValidationSummaryCards.tsx` / `PathDiscrepancyTable.tsx` - Traffic validation
  - `EntryPointAnalysis.tsx` / `NewVsReturningChart.tsx` / `PerformanceByPage.tsx` / `PageDetailsModal.tsx` - Additional analytics views
  - `SitemapBubbleChart.tsx` - Sitemap visualization
- `dashboard/` - Dashboard layout and navigation shell
  - `DashboardLayout.tsx` - Main layout wrapper (sidebar, header, content area)
  - `DashboardClient.tsx` - Client-side dashboard orchestration
  - `DashboardHeader.tsx` - Top header bar
  - `NavigationTabs.tsx` - Dashboard tab navigation
  - `ServiceSelector.tsx` - Service/site picker dropdown
  - `UserDropdown.tsx` - User menu (profile, tenant switch, sign out)
  - `ImpersonationBanner.tsx` - Warning banner shown during superadmin impersonation
- `settings/` - Organization settings components
  - `MembersTable.tsx` - Team member list with role management
  - `InviteModal.tsx` / `InvitesTable.tsx` - User invitation UI
  - `RoleSelector.tsx` - Role dropdown (respects RBAC hierarchy)
  - `RemoveUserDialog.tsx` - Confirmation dialog for user removal
  - `AuditLogsTable.tsx` - Audit trail viewer
  - `DomainManager.tsx` - Domain verification management
  - `index.ts` - Barrel export
- `query/` - Query builder UI components
  - `QueryWorkspace.tsx` - Main query builder page layout
  - `QueryBuilderPanel.tsx` - Visual query construction panel
  - `QuerySentenceBuilder.tsx` - Natural language query builder
  - `QueryResultsTable.tsx` - Query results display
  - `QueryVisualization.tsx` - Chart rendering for query results
  - `SQLEditor.tsx` - Raw SQL editor
  - `MetricBuilder.tsx` / `DimensionBuilder.tsx` / `FilterBuilder.tsx` - Query parameter builders
  - `DataSourceSelector.tsx` / `ChartTypeSelector.tsx` / `QueryTimeRangePicker.tsx` - Selection controls
  - `SaveQueryDialog.tsx` - Query save dialog
  - `QueryPageClient.tsx` - Supporting components
- `providers/` - React context providers
  - `ThemeProvider.tsx` - Dark/light theme context
- `ui/` - Primitive UI components (shadcn/ui)
  - `button.tsx`, `card.tsx`, `input.tsx`, `skeleton.tsx` - Base components
  - `data-table.tsx` - Reusable data table
  - `gauge.tsx` - Gauge chart component
  - `safe-echarts.tsx` - ECharts wrapper with error boundaries
  - `theme-toggle.tsx` - Dark/light mode toggle

## Key Patterns

Components are organized by feature, not by type. There is no `components/buttons/` or `components/forms/` directory. If you are building a new dashboard page, create its components in `analytics/`. If you are building a new settings panel, add to `settings/`. Only truly generic, reusable primitives go in `ui/`.

Charts use ECharts (via `safe-echarts.tsx` wrapper) for complex visualizations like Sankey diagrams and gauges, and Recharts for simpler time series charts. The `safe-echarts.tsx` wrapper handles SSR safety and error boundaries. New chart components should follow the pattern of existing ones in `analytics/`.

## Decisions

- **Feature-based organization over type-based.** Components live next to the feature they serve. This means you can find everything related to the marketing funnel in `analytics/ConversionFunnel.tsx` and `analytics/FunnelFilterPanel.tsx` without hunting across `components/charts/`, `components/panels/`, etc.
- **shadcn/ui for primitives.** The `ui/` directory contains copy-paste components from shadcn/ui that we own and can modify. These are not imported from a package -- they live in the repo. When you need a new primitive (dialog, dropdown, tabs), generate it with shadcn/ui CLI and it lands here.
- **Two charting libraries.** ECharts handles complex visualizations (Sankey, gauge, bubble charts) where Recharts lacks capability. Recharts handles standard time series and bar charts with less boilerplate. This is intentional, not accidental duplication.

## Related

- `../../app/(app)/` - Dashboard pages that compose these components
- `../../lib/` - Business logic and data fetching these components depend on
- `../../app/api/` - API routes that components call via fetch
