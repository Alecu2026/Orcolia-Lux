import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/dal";
import { prisma } from "@/lib/prisma";
import { getUserTimezone } from "@/lib/queries/settings";
import { transcribeAudio, parseUniversalCommand, VoiceError } from "@/lib/services/voice";

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
    const [tz, users, teams, projects, clients] = await Promise.all([
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
      prisma.client.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    ]);

    const context = { users, teams, projects, clients };
    const buffer = await audio.arrayBuffer();
    const transcript = await transcribeAudio(buffer, "voice.webm", audio.type || "audio/webm");
    const parsed = await parseUniversalCommand(transcript, tz, context);

    await prisma.voiceCommandLog
      .create({ data: { userId: user.id, source: "WEB", transcript, parsedJson: parsed, status: "PARSED" } })
      .catch(() => {});

    return NextResponse.json({ transcript, parsed, context });
  } catch (e) {
    const msg = e instanceof VoiceError ? e.message : "Eroare la procesarea vocii.";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
