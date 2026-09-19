import { errorResponse } from '@/lib/api-response';
import { getCurrentUser } from '@/lib/auth';
import { getStore, updateStore } from '@/lib/local-store';

export const dynamic = 'force-dynamic';

function csvCell(value: unknown) {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

export async function GET(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) return errorResponse('UNAUTHORIZED', 'Not authenticated', 401);
    const format = new URL(request.url).searchParams.get('format') === 'csv' ? 'csv' : 'json';
    const store = await getStore();
    const activeSessionId = store.activeSessionIds[user.id] ?? store.sessions.find((session) => session.userId === user.id)?.id;
    const sessions = store.sessions.filter((session) => session.userId === user.id && session.id === activeSessionId);
    if (sessions[0]) {
      await updateStore((current) => {
        const session = current.sessions.find((item) => item.id === activeSessionId && item.userId === user.id);
        if (session && !session.decisionEvents.some((event) => event.event === 'REPORT GENERATED')) session.decisionEvents.push({ timestamp: new Date().toISOString(), event: 'REPORT GENERATED', details: `Report generated as ${format.toUpperCase()}` });
      });
    }
    const report = {
      generatedAt: new Date().toISOString(),
      sessions: sessions.map((session) => ({
        id: session.id,
        file: session.originalName,
        status: session.status,
        createdAt: session.createdAt,
        detections: session.detections.length,
        tracks: session.tracks.length,
        candidates: session.candidates,
        priorityEvents: session.priorityEvents,
        demoScenario: session.demoScenario ?? false,
        selectedTrackId: session.selectedTrackId ?? null,
        simulationActive: session.simulationActive ?? false,
        decisionEvents: session.decisionEvents,
        estimatedTimeSaved: session.priorityEvents.reduce((sum, event) => sum + event.estimatedTimeSaved, 0),
      })),
    };
    if (format === 'json') {
      return new Response(JSON.stringify(report, null, 2), { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': 'attachment; filename="signalguard-report.json"' } });
    }
    const rows = [['Session', 'File', 'Status', 'Created', 'Detections', 'Tracks', 'Candidates', 'Priority Events', 'Estimated Time Saved'], ...report.sessions.map((session) => [session.id, session.file, session.status, session.createdAt, session.detections, session.tracks, session.candidates.length, session.priorityEvents.length, session.estimatedTimeSaved])];
    return new Response(rows.map((row) => row.map(csvCell).join(',')).join('\n'), { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="signalguard-report.csv"' } });
  } catch (error) {
    console.error('Report error:', error);
    return errorResponse('SERVER_ERROR', 'Unable to generate report', 500);
  }
}
