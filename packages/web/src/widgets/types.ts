// Widget-shared types used across the widget catalog infrastructure.
// Body-specific types (WidgetBodyProps, WidgetRegistry) live in bodies/types.ts.

export interface LiveAgent {
  agent_id: string;
  handle: string;
  host_tool: string;
  agent_surface: string | null;
  files: string[];
  summary: string | null;
  session_minutes: number | null;
  teamName: string;
  teamId: string;
}
