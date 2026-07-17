import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/dal";
import { prisma } from "@/lib/prisma";
import { getUserTimezone } from "@/lib/queries/settings";
import { transcribeAndParse, VoiceError } from "@/lib/services/voice";

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
    const tz = await getUserTimezone(user.id);
    const buffer = await audio.arrayBuffer();
    const { transcript, parsed } = await transcribeAndParse(
      buffer,
      "voice.webm",
      audio.type || "audio/webm",
      tz,
    );

    await prisma.voiceCommandLog
      .create({
        data: { userId: user.id, source: "WEB", transcript, parsedJson: parsed, status: "PARSED" },
      })
      .catch(() => {});

    return NextResponse.json({ transcript, parsed });
  } catch (e) {
    const msg = e instanceof VoiceError ? e.message : "Eroare la procesarea vocii.";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
