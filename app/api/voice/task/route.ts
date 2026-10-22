import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/dal";
import { prisma } from "@/lib/prisma";
import { getUserTimezone } from "@/lib/queries/settings";
import { transcribeAudio, parseUniversalCommand, VoiceError } from "@/lib/services/voice";
import { matchClientsByName } from "@/lib/queries/voice-clients";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Neautentificat" }, { status: 401 });

  const form = await req.formData().catch(() => null);
  const audio = form?.get("audio");
  if (!(audio instanceof Blob)) {
    return NextResponse.json({ error: "Lipsește fișierul audio." }, { status: 400 });
  }

  try {
    // Clienții NU se încarcă toți (după importul plătitorilor sunt ~19.000: depășeau limita AI-ului și umpleau ecranul): AI întoarce numele
    // spus, iar mai jos îl potrivim cu baza de date.
    const [tz, users, teams, projects] = await Promise.all([
      getUserTimezone(user.id),
      prisma.user.findMany({
        where: { isActive: true },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      }),
      prisma.team.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
      prisma.project.findMany({
        where: { status: "ACTIVE" },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      }),
    ]);

    const context = { users, teams, projects, clients: [] as { id: string; name: string }[] };
    const buffer = await audio.arrayBuffer();
    const transcript = await transcribeAudio(buffer, "voice.webm", audio.type || "audio/webm");
    const parsed = await parseUniversalCommand(transcript, tz, context);

    // Clientul spus → potriviri din baza de date. Potrivire clară = preselectat; mai multe = alege utilizatorul; niciuna = client nou.
    if (parsed.clientName && parsed.entity !== "client") {
      const m = await matchClientsByName(parsed.clientName).catch(() => ({ options: [], bestId: null }));
      context.clients = m.options;
      if (m.bestId) {
        parsed.clientId = m.bestId;
        delete parsed.newClientName;
      } else if (m.options.length === 0) {
        parsed.newClientName = parsed.newClientName || parsed.clientName;
      }
    }

    await prisma.voiceCommandLog
      .create({ data: { userId: user.id, source: "WEB", transcript, parsedJson: parsed, status: "PARSED" } })
      .catch(() => {});

    return NextResponse.json({ transcript, parsed, context });
  } catch (e) {
    const msg = e instanceof VoiceError ? e.message : "Eroare la procesarea vocii.";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
